/**
 * Two-player Hands scenarios through the real client and server, without Discord.
 *
 * Requires Playwright with Chromium (for example `npm install -g playwright && npx playwright
 * install chromium`, then run with NODE_PATH pointing at that global node_modules), a Vite dev
 * server started with HANDS_DEV_BACKEND=http://127.0.0.1:8091 (override with E2E_BASE), and uv.
 * Each scenario spawns scripts/hands_e2e_server.py on port 8091, drives two headless players with
 * keyboard or touch input, reads the client's screen-reader status text, and writes screenshots to
 * $TMPDIR/hands-e2e. Set E2E_GPU=1 to render on the machine's GPU instead of the software renderer
 * (real frame pacing and input latency). The response scenario takes E2E_DELAY_MS and E2E_JITTER_MS.
 *
 * The cpu scenario is one player against the computer (E2E_CPU_LEVEL, default contender) through to the
 * result card. The styles scenario has one fighter pick a style with the keyboard and the other by
 * touch while a spectator watches; every other scenario settles on the offered style at once. E2E_PORT
 * moves the server off 8091.
 *
 *   node scripts/hands_e2e_scenarios.js ko|reconnect|rest|spectator|touch|mash|latency|soak|background|rematch|rematchloop|clinch|response|cpu|styles
 */
const { chromium, devices } = require('playwright');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');

const base = process.env.E2E_BASE || 'http://localhost:5174';
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const repo = path.resolve(__dirname, '..');
const out = path.join(os.tmpdir(), 'hands-e2e');
fs.mkdirSync(out, { recursive: true });
const scenario = process.argv[2] || 'ko';
const PORT = Number(process.env.E2E_PORT ?? 8091);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function healthz() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/healthz`, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

/**
 * TCP proxy that delays every chunk in both directions, so websocket frames see real latency.
 * `jitterMs` adds a random extra wait to each chunk while keeping them in order.
 */
function delayProxy(listenPort, targetPort, delayMs, jitterMs = 0) {
  const server = net.createServer((client) => {
    const upstream = net.connect(targetPort, '127.0.0.1');
    const pipe = (from, to) => {
      const queue = [];
      let timer = null;
      const drain = () => {
        timer = null;
        while (queue.length > 0 && queue[0].due <= Date.now()) {
          const { chunk } = queue.shift();
          if (chunk === null) to.end();
          else if (!to.destroyed) to.write(chunk);
        }
        if (queue.length > 0) timer = setTimeout(drain, Math.max(1, queue[0].due - Date.now()));
      };
      const hold = (chunk) => {
        const due = Math.max(queue.at(-1)?.due ?? 0, Date.now() + delayMs + Math.random() * jitterMs);
        queue.push({ chunk, due });
        if (timer === null) timer = setTimeout(drain, Math.max(1, queue[0].due - Date.now()));
      };
      from.on('data', hold);
      from.on('end', () => hold(null));
      from.on('error', () => to.destroy());
    };
    pipe(client, upstream);
    pipe(upstream, client);
  });
  server.listen(listenPort, '127.0.0.1');
  return server;
}

async function startServer(args, { oneWayDelayMs = 0, jitterMs = 0 } = {}) {
  const backendPort = oneWayDelayMs > 0 ? PORT + 1 : PORT;
  const child = spawn('uv', ['run', 'python', 'scripts/hands_e2e_server.py', '--port', String(backendPort), ...args], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  const proxy = oneWayDelayMs > 0 ? delayProxy(PORT, backendPort, oneWayDelayMs, jitterMs) : null;
  for (let i = 0; i < 60; i += 1) { if (await healthz()) return { child, log, proxy }; await wait(500); }
  throw new Error('server did not start: ' + log.join(''));
}

async function status(page) {
  return page.evaluate(() => ({
    status: document.querySelector('[data-status]')?.textContent ?? null,
    live: document.querySelector('[data-fight-status]')?.textContent ?? null,
    summary: document.querySelector('[data-fight-summary]')?.textContent ?? null,
    final: document.querySelector('[data-final]')?.textContent ?? null,
    role: document.querySelector('[data-role]')?.hidden === false ? document.querySelector('[data-role]')?.textContent : null,
  }));
}

/** Settles on the style the picker offers, as soon as the pick before the bout appears. */
async function settleStyle(page) {
  await page.waitForSelector('[data-style-picker]:not([hidden])', { timeout: 60000 });
  await page.keyboard.press('Enter');
}

async function pickerState(page) {
  return page.evaluate(() => {
    const element = document.querySelector('[data-style-picker]');
    if (element === null) return null;
    return {
      hidden: element.hidden,
      chosen: element.querySelector('[data-chosen]')?.dataset.style ?? null,
      disabled: [...element.querySelectorAll('[data-style]')].filter((button) => button.disabled).length,
      clock: element.querySelector('.style-clock')?.textContent ?? null,
      status: element.querySelector('.style-status')?.textContent ?? null,
    };
  });
}

async function waitFor(page, predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const s = await status(page);
    if (predicate(s)) return s;
    await wait(250);
  }
  const s = await status(page);
  console.log(`TIMEOUT waiting for ${label}:`, JSON.stringify(s).slice(0, 300));
  return null;
}

/**
 * Counts the WebGL objects alive in the page and the bytes their textures hold. renderer.info cannot
 * show a leak across rematches: it starts again at zero with every renderer on the shared context.
 */
function countLiveGlObjects() {
  const live = { buffers: 0, textures: 0, programs: 0, shaders: 0, framebuffers: 0, renderbuffers: 0 };
  const proto = WebGL2RenderingContext.prototype;
  for (const [create, remove, key] of [['createBuffer', 'deleteBuffer', 'buffers'], ['createTexture', 'deleteTexture', 'textures'], ['createProgram', 'deleteProgram', 'programs'], ['createShader', 'deleteShader', 'shaders'], ['createFramebuffer', 'deleteFramebuffer', 'framebuffers'], ['createRenderbuffer', 'deleteRenderbuffer', 'renderbuffers']]) {
    const made = proto[create];
    const gone = proto[remove];
    proto[create] = function (...args) { const object = made.apply(this, args); if (object) live[key] += 1; return object; };
    proto[remove] = function (object) { if (object) live[key] -= 1; return gone.call(this, object); };
  }
  const bytes = new Map();
  const bound = new Map();
  let unit = 0;
  const activeTexture = proto.activeTexture;
  proto.activeTexture = function (value) { unit = value; return activeTexture.call(this, value); };
  const bindTexture = proto.bindTexture;
  proto.bindTexture = function (target, texture) { bound.set(`${unit}:${target}`, texture); return bindTexture.call(this, target, texture); };
  const texelBytes = (format) => (format === 0x8814 || format === 0x8D70 ? 16 : format === 0x881A ? 8 : 4);
  const texStorage2D = proto.texStorage2D;
  proto.texStorage2D = function (target, levels, format, width, height) {
    const texture = bound.get(`${unit}:${target}`);
    let total = 0;
    for (let level = 0, w = width, h = height; level < levels; level += 1, w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) total += w * h * texelBytes(format);
    if (texture) bytes.set(texture, total * (target === 0x8513 ? 6 : 1));
    return texStorage2D.call(this, target, levels, format, width, height);
  };
  const texImage2D = proto.texImage2D;
  proto.texImage2D = function (...args) {
    const texture = bound.get(`${unit}:${args[0]}`);
    if (texture && args.length >= 9 && args[1] === 0) bytes.set(texture, args[3] * args[4] * 4);
    else if (texture && args.length === 6 && args[1] === 0 && args[5] && args[5].width) bytes.set(texture, args[5].width * args[5].height * 4);
    return texImage2D.apply(this, args);
  };
  const deleteTexture = proto.deleteTexture;
  proto.deleteTexture = function (texture) { bytes.delete(texture); return deleteTexture.call(this, texture); };
  window.__glLive = () => ({ ...live, textureMb: Math.round([...bytes.values()].reduce((a, b) => a + b, 0) / 104857.6) / 10 });
}

async function main() {
  const gpuArgs = process.env.E2E_GPU === '1'
    ? ['--enable-gpu', '--ignore-gpu-blocklist']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const browser = await chromium.launch({ args: gpuArgs });
  const instance = `e2e-${scenario}-${Date.now()}`;
  const open = async (name, options = {}) => {
    const context = await browser.newContext(options.mobile ? { ...devices['Pixel 7'], viewport: { width: 844, height: 390 } } : { viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    if (scenario === 'rematchloop') await page.addInitScript(countLiveGlObjects);
    if (scenario === 'response') {
      // Records when each input frame that carries a press leaves the page, to time press to send.
      await page.addInitScript(() => {
        const send = WebSocket.prototype.send;
        window.__actionSends = [];
        WebSocket.prototype.send = function (data) {
          if (typeof data === 'string' && data.includes('"actions":[{')) window.__actionSends.push(performance.timeOrigin + performance.now());
          return send.call(this, data);
        };
      });
    }
    const errors = [];
    page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message.slice(0, 240)}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console.error: ${m.text().slice(0, 240)}`); });
    await page.goto(`${base}/?e2e=1&instance_id=${instance}&player=${name}${options.mobile ? '&platform=mobile' : ''}`, { waitUntil: 'load' });
    return { page, context, errors, name };
  };
  const report = { scenario, events: [], errors: [] };
  const note = (...parts) => { const line = parts.join(' '); report.events.push(line); console.log(line); };

  const serverArgs = {
    ko: ['--rounds', '3', '--round-seconds', '90', '--rest-seconds', '5'],
    reconnect: ['--rounds', '1', '--round-seconds', '70', '--rest-seconds', '5'],
    rest: ['--rounds', '2', '--round-seconds', '14', '--rest-seconds', '9'],
    spectator: ['--rounds', '1', '--round-seconds', '30', '--rest-seconds', '5'],
    touch: ['--rounds', '1', '--round-seconds', '40', '--rest-seconds', '5'],
    mash: ['--rounds', '1', '--round-seconds', '40', '--rest-seconds', '5'],
    latency: ['--rounds', '1', '--round-seconds', '45', '--rest-seconds', '5'],
    soak: ['--rounds', '3', '--round-seconds', '120', '--rest-seconds', '15'],
    background: ['--rounds', '1', '--round-seconds', '60', '--rest-seconds', '5'],
    rematch: ['--rounds', '1', '--round-seconds', '25', '--rest-seconds', '5'],
    rematchloop: ['--rounds', '1', '--round-seconds', '20', '--rest-seconds', '5'],
    clinch: ['--rounds', '1', '--round-seconds', '30', '--rest-seconds', '5'],
    response: ['--rounds', '1', '--round-seconds', '40', '--rest-seconds', '5'],
    cpu: ['--rounds', '2', '--round-seconds', '40', '--rest-seconds', '6'],
    styles: ['--rounds', '1', '--round-seconds', '30', '--rest-seconds', '5', '--style-select-seconds', '30'],
  }[scenario];
  const responseDelayMs = Number(process.env.E2E_DELAY_MS ?? 60);
  const responseJitterMs = Number(process.env.E2E_JITTER_MS ?? 0);
  const server = await startServer(serverArgs, { oneWayDelayMs: scenario === 'latency' ? 110 : scenario === 'response' ? responseDelayMs : 0, jitterMs: scenario === 'response' ? responseJitterMs : 0 });
  try {
    const A = await open('Alpha');
    if (scenario === 'cpu') {
      await runCpu(A, note);
      report.errors.push(...A.errors);
      return;
    }
    const B = await open('Bravo', { mobile: scenario === 'touch' || scenario === 'rest' || scenario === 'styles' });
    if (scenario === 'styles') await pickStyles(A, B, open, note, report);
    else await Promise.all([settleStyle(A.page), settleStyle(B.page)]);
    if (scenario === 'latency') note('both clients behind a TCP proxy adding 110 ms each way (220 ms round trip) to every frame');
    const startedState = await waitFor(A.page, (s) => /countdown|fight/.test(s.summary ?? ''), 60000, 'bout start');
    note('bout started:', startedState !== null);
    await waitFor(A.page, (s) => /\. fight\./.test(s.summary ?? ''), 20000, 'fight phase');
    // Approach: A right, B left.
    await A.page.keyboard.down('d'); await B.page.keyboard.down('a'); await wait(1600); await A.page.keyboard.up('d'); await B.page.keyboard.up('a');

    if (scenario === 'ko') {
      // Records every fighter's punch phase while the knockout replay plays, to catch a stuttering replay.
      await A.page.evaluate(() => {
        const state = { frames: 0, jumps: 0, worst: 0 };
        window.__replayProbe = state;
        const last = [{ id: null, age: 0 }, { id: null, age: 0 }];
        const tick = () => {
          const renderer = window.__handsApp?.renderer;
          if (renderer?.replay && renderer.graphs) {
            state.frames += 1;
            renderer.graphs.forEach((graph, index) => {
              const id = graph.punchActive ? graph.actionId : null;
              const age = graph.punchAgeTicks;
              if (id !== null && id === last[index].id && last[index].age - age > 0.5) { state.jumps += 1; state.worst = Math.max(state.worst, last[index].age - age); }
              last[index] = { id, age };
            });
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      let downSeen = false; let promptsPressed = 0; let final = null; let lastCount = -1;
      const started = Date.now();
      await A.page.keyboard.down('Alt');
      while (Date.now() - started < 240000) {
        const sB = await status(B.page);
        if (sB.final) { final = sB; break; }
        const live = sB.live ?? '';
        if (/^Knockdown/.test(live) || /\. knockdown\./.test(sB.summary ?? '')) {
          if (!downSeen) { downSeen = true; note('KNOCKDOWN seen at', ((Date.now() - started) / 1000).toFixed(1), 's:', live); await A.page.screenshot({ path: `${out}/e2e-ko-A-down.png` }); await B.page.screenshot({ path: `${out}/e2e-ko-B-down.png` }); }
          const count = /Count (\d+)/.exec(live); if (count && Number(count[1]) !== lastCount) { lastCount = Number(count[1]); note('count', lastCount, '|', live); }
          if (/Press left now/.test(live)) { await B.page.keyboard.press('ArrowLeft'); promptsPressed += 1; }
          else if (/Press right now/.test(live)) { await B.page.keyboard.press('ArrowRight'); promptsPressed += 1; }
          await wait(60);
          continue;
        }
        // A keeps pressure: step in, throw power hooks and uppercuts, occasionally straights.
        await A.page.keyboard.down('d'); await wait(120); await A.page.keyboard.up('d');
        const key = ['g', 't', 'h', 'y', 'u'][Math.floor(Math.random() * 5)];
        await A.page.keyboard.press(key);
        await wait(380);
      }
      await A.page.keyboard.up('Alt');
      note('get-up presses:', promptsPressed);
      note('input latency A:', JSON.stringify(await A.page.evaluate(() => window.__handsApp?.networkStats ?? null)), 'B:', JSON.stringify(await B.page.evaluate(() => window.__handsApp?.networkStats ?? null)));
      if (final === null) final = await waitFor(B.page, (s) => Boolean(s.final), 120000, 'final');
      note('FINAL:', JSON.stringify(final?.final ?? null));
      await A.page.screenshot({ path: `${out}/e2e-ko-A-final.png` }); await B.page.screenshot({ path: `${out}/e2e-ko-B-final.png` });
      await wait(8000);
      await A.page.screenshot({ path: `${out}/e2e-ko-A-result.png` });
      note('knockout replay:', JSON.stringify(await A.page.evaluate(() => window.__replayProbe)));
    }

    if (scenario === 'styles') {
      await wait(800);
      await A.page.screenshot({ path: `${out}/e2e-styles-A-plates.png` });
      await B.page.screenshot({ path: `${out}/e2e-styles-B-plates.png` });
    }

    if (scenario === 'reconnect') {
      for (let i = 0; i < 6; i += 1) { await A.page.keyboard.press('f'); await B.page.keyboard.press('j'); await wait(400); }
      note('before drop A:', (await status(A.page)).status, '| B:', (await status(B.page)).status);
      await B.context.setOffline(true);
      note('B offline');
      const paused = await waitFor(A.page, (s) => /paused|reconnect/i.test((s.status ?? '') + (s.live ?? '')), 30000, 'opponent pause on A');
      note('A during drop:', paused?.status, '|', paused?.live);
      await B.page.screenshot({ path: `${out}/e2e-reconnect-B-offline.png` });
      await wait(3000);
      await B.context.setOffline(false);
      note('B online');
      const resumed = await waitFor(A.page, (s) => /in progress|fight/i.test((s.status ?? '') + (s.summary ?? '')) && !/paused|reconnect/i.test(s.status ?? ''), 40000, 'resume on A');
      note('A after resume:', resumed?.status, '|', resumed?.live);
      const bBack = await waitFor(B.page, (s) => /in progress|fight/i.test((s.status ?? '') + (s.summary ?? '')) && !/Unable|paused|reconnect/i.test(s.status ?? ''), 40000, 'B resumed');
      note('B after resume:', bBack?.status, '|', bBack?.live);
      // The server stopped for the drop; the render clock must find it again rather than show only the newest snapshot.
      await wait(1500);
      for (const [label, page] of [['A', A.page], ['B', B.page]]) {
        const clock = await page.evaluate(() => new Promise((resolve) => {
          const buffer = window.__handsApp?.renderer?.buffer;
          let frames = 0;
          let atLatest = 0;
          const end = performance.now() + 2000;
          const tick = (now) => {
            const latest = buffer?.latest?.();
            if (buffer && latest && buffer.offsetTicks !== null) {
              frames += 1;
              if ((now * 30) / 1000 + buffer.offsetTicks - buffer.interpolationDelayTicks >= latest.tick) atLatest += 1;
            }
            if (now < end) requestAnimationFrame(tick);
            else resolve({ frames, atLatest, delayTicks: buffer?.interpolationDelayTicks ?? null });
          };
          requestAnimationFrame(tick);
        }));
        note(`${label} render clock after the resume: ${clock.atLatest} of ${clock.frames} frames held on the newest snapshot, delay ${clock.delayTicks} ticks`);
        if (clock.frames === 0 || clock.atLatest > clock.frames * 0.2) report.errors.push(`${label} render clock did not recover after the resume (${clock.atLatest} of ${clock.frames} frames at the newest snapshot)`);
      }
      for (let i = 0; i < 6; i += 1) { await A.page.keyboard.press('f'); await B.page.keyboard.press('j'); await wait(400); }
      note('B summary after resume:', (await status(B.page)).summary?.slice(0, 160));
      const final = await waitFor(A.page, (s) => Boolean(s.final), 120000, 'final');
      note('FINAL A:', JSON.stringify(final?.final ?? null).slice(0, 200));
      note('FINAL B:', JSON.stringify((await status(B.page)).final).slice(0, 200));
    }

    if (scenario === 'rest') {
      for (let i = 0; i < 8; i += 1) { await A.page.keyboard.press('f'); await B.page.keyboard.press('j'); await wait(400); }
      const rest = await waitFor(A.page, (s) => /\. rest\./.test(s.summary ?? ''), 40000, 'rest phase');
      note('rest reached:', rest !== null, '|', rest?.status, '|', rest?.live);
      // Each corner gets an instruction: Alpha with the 3 key, Bravo by tapping the panel on a phone.
      const own = (page) => page.evaluate(() => {
        const app = window.__handsApp;
        return app?.state?.snapshot?.fighters.find((fighter) => fighter.player_id === app.state.playerId) ?? null;
      });
      const panelShown = (page) => page.evaluate(() => document.querySelector('[data-corner]')?.hidden === false);
      await wait(800);
      note('corner panels shown:', await panelShown(A.page), await panelShown(B.page));
      await A.page.screenshot({ path: `${out}/e2e-rest-A-panel.png` }); await B.page.screenshot({ path: `${out}/e2e-rest-B-panel.png` });
      const beforeA = await own(A.page);
      const beforeB = await own(B.page);
      await A.page.keyboard.press('3');
      await B.page.tap('[data-corner-pick="corner_cut"]');
      await wait(1200);
      const afterA = await own(A.page);
      const afterB = await own(B.page);
      const corner = await Promise.all([A.page, B.page].map((page) => page.evaluate(() => document.querySelector('.corner-status')?.textContent ?? null)));
      note('corner choices:', afterA?.corner_choice, afterB?.corner_choice, '|', corner.join(' | '));
      note('Alpha health', beforeA?.conditioning, '->', afterA?.conditioning, '| Bravo cuts', beforeB?.trauma.left_cut, beforeB?.trauma.right_cut, '->', afterB?.trauma.left_cut, afterB?.trauma.right_cut);
      const cutBefore = Math.max(beforeB?.trauma.left_cut ?? 0, beforeB?.trauma.right_cut ?? 0);
      const cutAfter = Math.max(afterB?.trauma.left_cut ?? 0, afterB?.trauma.right_cut ?? 0);
      const cornerWorked = afterA?.corner_choice === 'breath' && afterB?.corner_choice === 'cut'
        && afterA.conditioning === Math.min(1000, beforeA.conditioning + 180)
        && cutAfter === Math.max(0, cutBefore - 250);
      note('CORNER CHECK:', cornerWorked ? 'PASS' : 'FAIL');
      if (!cornerWorked) report.errors.push('corner instructions did not take effect');
      await wait(2500);
      await A.page.screenshot({ path: `${out}/e2e-rest-A.png` }); await B.page.screenshot({ path: `${out}/e2e-rest-B.png` });
      await B.page.setViewportSize({ width: 390, height: 844 });
      await wait(700);
      await B.page.screenshot({ path: `${out}/e2e-rest-B-portrait.png` });
      await B.page.setViewportSize({ width: 844, height: 390 });
      const round2 = await waitFor(A.page, (s) => /Round 2\. fight/.test(s.summary ?? ''), 40000, 'round 2');
      note('round 2 reached:', round2 !== null, '|', round2?.summary?.slice(0, 60), '| panels hidden:', !(await panelShown(A.page)) && !(await panelShown(B.page)));
      await A.page.keyboard.down('d'); await B.page.keyboard.down('a'); await wait(2500); await A.page.keyboard.up('d'); await B.page.keyboard.up('a');
      await A.page.screenshot({ path: `${out}/e2e-rest-A-round2.png` });
      const final = await waitFor(A.page, (s) => Boolean(s.final), 90000, 'final');
      note('FINAL:', JSON.stringify(final?.final ?? null).slice(0, 200));
    }

    if (scenario === 'spectator') {
      const S = await open('Watcher');
      const spec = await waitFor(S.page, (s) => /spectat/i.test((s.status ?? '') + (s.role ?? '')) || Boolean(s.summary), 30000, 'spectator join');
      note('spectator:', spec?.status, '| role:', spec?.role, '| summary:', spec?.summary?.slice(0, 80));
      for (let i = 0; i < 6; i += 1) { await A.page.keyboard.press('f'); await B.page.keyboard.press('j'); await S.page.keyboard.press('f'); await wait(400); }
      await S.page.screenshot({ path: `${out}/e2e-spectator.png` });
      note('spectator after inputs:', (await status(S.page)).status);
      const final = await waitFor(S.page, (s) => Boolean(s.final), 90000, 'spectator final');
      note('SPECTATOR FINAL:', JSON.stringify(final?.final ?? null).slice(0, 160));
      report.errors.push(...S.errors);
    }

    if (scenario === 'touch') {
      const before = await status(A.page);
      note('touch controls present on B:', await B.page.evaluate(() => document.querySelectorAll('.touch-pad').length));
      const pad = await B.page.$('.touch-pad[data-punch="jab"]');
      const box = await pad.boundingBox();
      for (let i = 0; i < 10; i += 1) {
        await B.page.touchscreen.tap(box.x + box.width * 0.75, box.y + box.height / 2);
        await wait(350);
        await B.page.touchscreen.tap(box.x + box.width * 0.25, box.y + box.height / 2);
        await wait(350);
      }
      const stick = await B.page.$('.touch-stick');
      const sb = await stick.boundingBox();
      const cdp = await B.context.newCDPSession(B.page);
      const sx = sb.x + sb.width / 2, sy = sb.y + sb.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx - 50, y: sy }] });
      await wait(1200);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await B.page.screenshot({ path: `${out}/e2e-touch-B.png` });
      const after = await status(A.page);
      note('A summary before:', before.summary?.slice(0, 200));
      note('A summary after :', after.summary?.slice(0, 200));
      const final = await waitFor(A.page, (s) => Boolean(s.final), 90000, 'final');
      note('FINAL:', JSON.stringify(final?.final ?? null).slice(0, 200));
    }

    if (scenario === 'mash') {
      const keys = ['f', 'j', 'r', 'u', 'g', 'h', 't', 'y', 'q', 'e', 'z', 'x', 'c', 'v', 'b', 'm'];
      const started = Date.now();
      let presses = 0;
      while (Date.now() - started < 15000) {
        const key = keys[presses % keys.length];
        await A.page.keyboard.press(key, { delay: 0 });
        presses += 1;
        if (presses % 40 === 0) { await A.page.keyboard.down('d'); await wait(40); await A.page.keyboard.up('d'); }
      }
      note('presses in 15 s:', presses, `(${(presses / 15).toFixed(0)}/s)`);
      const after = await status(A.page);
      note('A after mash:', after.status, '|', after.summary?.slice(0, 120));
      note('B after mash:', (await status(B.page)).status);
      const final = await waitFor(A.page, (s) => Boolean(s.final), 90000, 'final');
      note('FINAL:', JSON.stringify(final?.final ?? null).slice(0, 200));
    }

    if (scenario === 'latency') {
      const started = Date.now();
      let step = 0;
      const stats = (page) => page.evaluate(() => window.__handsApp?.networkStats?.inputLatencyMs ?? null);
      while (Date.now() - started < 25000) {
        await A.page.keyboard.press(['f', 'r', 'g'][step % 3]);
        await B.page.keyboard.press(['j', 'u', 'h'][step % 3]);
        if (step % 4 === 0) { await B.page.keyboard.down('a'); await wait(150); await B.page.keyboard.up('a'); }
        await wait(420);
        step += 1;
        if (step % 8 === 0) note(`t=${((Date.now() - started) / 1000).toFixed(0)}s input latency A: ${Math.round((await stats(A.page)) ?? -1)} ms  B: ${Math.round((await stats(B.page)) ?? -1)} ms`);
      }
      const sA = await status(A.page); const sB = await status(B.page);
      note('A:', sA.status, '|', sA.summary?.slice(0, 140));
      note('B:', sB.status, '|', sB.summary?.slice(0, 140));
      note('input latency A:', JSON.stringify(await A.page.evaluate(() => window.__handsApp?.networkStats ?? null)), 'B:', JSON.stringify(await B.page.evaluate(() => window.__handsApp?.networkStats ?? null)));
      await B.page.screenshot({ path: `${out}/e2e-latency-B.png` });
      const final = await waitFor(B.page, (s) => Boolean(s.final), 90000, 'final');
      note('FINAL B:', JSON.stringify(final?.final ?? null).slice(0, 200));
    }

    if (scenario === 'background') {
      for (let i = 0; i < 6; i += 1) { await A.page.keyboard.press('f'); await B.page.keyboard.press('j'); await wait(400); }
      const clock = (s) => /Clock (\d+:\d+)/.exec(s.summary ?? '')?.[1] ?? null;
      note('before freeze A clock', clock(await status(A.page)), 'B clock', clock(await status(B.page)));
      const cdp = await B.context.newCDPSession(B.page);
      await cdp.send('Page.enable');
      await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
      note('B frozen (backgrounded)');
      await wait(8000);
      for (let i = 0; i < 4; i += 1) { await A.page.keyboard.press('f'); await wait(300); }
      note('A during B freeze:', (await status(A.page)).status, '| clock', clock(await status(A.page)));
      await cdp.send('Page.setWebLifecycleState', { state: 'active' });
      note('B active again');
      await wait(2500);
      const sA = await status(A.page); const sB = await status(B.page);
      note('after resume A clock', clock(sA), 'status', sA.status, '| B clock', clock(sB), 'status', sB.status);
      for (let i = 0; i < 6; i += 1) { await B.page.keyboard.press('j'); await A.page.keyboard.press('f'); await wait(400); }
      const later = await status(B.page);
      note('B after inputs:', later.status, '| clock', clock(later), '| latency', JSON.stringify(await B.page.evaluate(() => window.__handsApp?.networkStats ?? null)));
      const final = await waitFor(B.page, (s) => Boolean(s.final), 90000, 'final');
      note('FINAL B:', JSON.stringify(final?.final ?? null).slice(0, 200));
      note('FINAL A:', JSON.stringify((await status(A.page)).final).slice(0, 200));
    }

    if (scenario === 'rematch') {
      for (let i = 0; i < 4; i += 1) { await A.page.keyboard.press('f'); await B.page.keyboard.press('j'); await wait(400); }
      const first = await waitFor(A.page, (s) => Boolean(s.final), 90000, 'first final');
      note('first final:', JSON.stringify(first?.final ?? null).slice(0, 90));
      const rematchState = (page) => page.evaluate(() => { const b = document.querySelector('[data-rematch]'); return b ? { hidden: b.hidden, disabled: b.disabled, text: b.textContent } : null; });
      note('rematch button right after final:', JSON.stringify(await rematchState(A.page)));
      const enabledAt = Date.now();
      for (let i = 0; i < 60; i += 1) { const s = await rematchState(A.page); if (s && !s.hidden && !s.disabled) break; await wait(500); }
      note('rematch enabled after', ((Date.now() - enabledAt) / 1000).toFixed(1), 's:', JSON.stringify(await rematchState(A.page)), JSON.stringify(await rematchState(B.page)));
      await A.page.click('[data-rematch]');
      await B.page.click('[data-rematch]');
      await Promise.all([settleStyle(A.page), settleStyle(B.page)]);
      const second = await waitFor(A.page, (s) => /countdown|\. fight\./.test(s.summary ?? '') && !s.final, 60000, 'second bout start');
      note('second bout started:', second !== null, '|', second?.status, '|', second?.summary?.slice(0, 60));
      await waitFor(A.page, (s) => /\. fight\./.test(s.summary ?? ''), 20000, 'second fight phase');
      for (let i = 0; i < 4; i += 1) { await A.page.keyboard.press('f'); await B.page.keyboard.press('j'); await wait(400); }
      const finalA = await waitFor(A.page, (s) => Boolean(s.final), 90000, 'second final');
      note('second final A:', JSON.stringify(finalA?.final ?? null).slice(0, 120));
      const finalB = await waitFor(B.page, (s) => Boolean(s.final), 15000, 'second final on B');
      note('second final B:', JSON.stringify(finalB?.final ?? null).slice(0, 120));
    }

    if (scenario === 'rematchloop') {
      const sample = (page) => page.evaluate(() => ({ heapMb: typeof performance.memory === 'object' && performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, gpu: window.__glLive?.() ?? null }));
      const rematchReady = (page) => page.evaluate(() => { const b = document.querySelector('[data-rematch]'); return Boolean(b && !b.hidden && !b.disabled); });
      const samples = [];
      for (let bout = 1; bout <= 4; bout += 1) {
        await waitFor(A.page, (s) => /\. fight\./.test(s.summary ?? ''), 30000, `bout ${bout} fight phase`);
        for (let i = 0; i < 6; i += 1) { await A.page.keyboard.press('f'); await B.page.keyboard.press('j'); await wait(350); }
        const final = await waitFor(A.page, (s) => Boolean(s.final), 90000, `bout ${bout} final`);
        await waitFor(B.page, (s) => Boolean(s.final), 15000, `bout ${bout} final on B`);
        const [a, b] = [await sample(A.page), await sample(B.page)];
        samples.push({ bout, a, b });
        note(`bout ${bout} final: ${JSON.stringify(final?.final ?? null).slice(0, 40)} | heap A ${a.heapMb} MB B ${b.heapMb} MB | gpu A ${JSON.stringify(a.gpu)} B ${JSON.stringify(b.gpu)}`);
        if (bout === 4) break;
        for (let i = 0; i < 60; i += 1) { if ((await rematchReady(A.page)) && (await rematchReady(B.page))) break; await wait(500); }
        await A.page.click('[data-rematch]');
        await B.page.click('[data-rematch]');
        await Promise.all([settleStyle(A.page), settleStyle(B.page)]);
        const next = await waitFor(A.page, (s) => /countdown|\. fight\./.test(s.summary ?? '') && !s.final, 60000, `bout ${bout + 1} start`);
        note(`bout ${bout + 1} started: ${next !== null}`);
      }
      if (samples.length >= 2) {
        const first = samples[0]; const last = samples.at(-1);
        const rebuilds = samples.length - 1;
        for (const side of ['a', 'b']) {
          const growth = Object.fromEntries(Object.keys(last[side].gpu ?? {}).map((key) => [key, Math.round(((last[side].gpu?.[key] ?? 0) - (first[side].gpu?.[key] ?? 0)) * 10) / 10]));
          note(`growth ${side.toUpperCase()} over ${rebuilds} rematches: heap ${last[side].heapMb - first[side].heapMb} MB; live GL objects ${JSON.stringify(growth)}`);
          // Each renderer leaves a few small objects inside three.js itself; a leaked model or bloom chain is megabytes.
          if ((growth.textureMb ?? 0) > rebuilds * 0.5) report.errors.push(`${side.toUpperCase()} texture memory grew ${growth.textureMb} MB over ${rebuilds} rematches`);
        }
      }
    }

    if (scenario === 'response') {
      note(`network delay ${responseDelayMs} ms each way (${responseDelayMs * 2} ms round trip), up to ${responseJitterMs} ms of jitter; times are key press to the first rendered frame, within one frame`);
      const probe = () => {
        const state = { frames: [], keys: [] };
        window.__probe = state;
        const epoch = () => performance.timeOrigin + performance.now();
        addEventListener('keydown', (event) => { if (!event.repeat) state.keys.push({ code: event.code, at: epoch() }); }, true);
        const tick = () => {
          const renderer = window.__handsApp?.renderer;
          const graphs = renderer?.graphs;
          const latest = renderer?.buffer?.latest?.();
          if (graphs && latest) {
            const Vector3 = graphs[0].boxer.root.position.constructor;
            const frame = { at: epoch(), viewer: latest.fighters.findIndex((fighter) => fighter.player_id === renderer.viewerId), news: latest.fighters.map((fighter) => fighter.action_id), delay: renderer.buffer.interpolationDelayTicks, fighters: [] };
            for (const graph of graphs) {
              const left = graph.boxer.rig.bones.gloveL.getWorldPosition(new Vector3());
              const right = graph.boxer.rig.bones.gloveR.getWorldPosition(new Vector3());
              const timing = graph.punchTiming;
              const age = graph.punchAgeTicks;
              const progress = age < timing.startup ? age / Math.max(1, timing.startup) : age < timing.startup + timing.active ? 1 + (age - timing.startup) / Math.max(1, timing.active) : 2 + Math.min(1, (age - timing.startup - timing.active) / Math.max(1, timing.recovery));
              frame.fighters.push({ active: graph.punchActive === true, age, progress, timing: `${graph.punchClass} ${timing.startup}/${timing.active}/${timing.recovery}`, x: graph.boxer.root.position.x, z: graph.boxer.root.position.z, left: [left.x, left.y, left.z], right: [right.x, right.y, right.z] });
            }
            state.frames.push(frame);
            if (state.frames.length > 6000) state.frames.shift();
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      };
      await A.page.evaluate(probe); await B.page.evaluate(probe);
      await wait(600);
      const presses = [];
      for (const key of ['f', 'f', 'f', 'u', 'u', 'g']) { await wait(1100); await A.page.keyboard.press(key); presses.push(key); }
      await wait(1200);
      await A.page.keyboard.down('a'); await wait(500); await A.page.keyboard.up('a');
      await wait(900);
      const a = await A.page.evaluate(() => window.__probe);
      const b = await B.page.evaluate(() => window.__probe);
      const distance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      const frameAt = (frames, at) => frames.findLast((frame) => frame.at <= at) ?? frames[0];
      const median = (values) => { const sorted = values.filter((v) => v !== null).sort((x, y) => x - y); return sorted.length === 0 ? null : Math.round(sorted[Math.floor(sorted.length / 2)]); };
      const viewerA = a.frames.at(-1).viewer;
      const punchKeys = a.keys.filter((key) => ['KeyF', 'KeyU', 'KeyG'].includes(key.code));
      const local = []; const moved = []; const remote = []; const shown = [];
      for (const key of punchKeys) {
        const hand = key.code === 'KeyU' ? 'right' : 'left';
        const before = frameAt(a.frames, key.at).fighters[viewerA];
        const started = a.frames.find((frame) => frame.at > key.at && frame.fighters[viewerA].active && frame.fighters[viewerA].age < 6);
        const glove = a.frames.find((frame) => frame.at > key.at && distance(frame.fighters[viewerA][hand], before[hand]) > 0.03);
        const seen = b.frames.find((frame) => frame.at > key.at && frame.fighters[viewerA].active && frame.fighters[viewerA].age < 8);
        local.push(started ? started.at - key.at : null); moved.push(glove ? glove.at - key.at : null); remote.push(seen ? seen.at - key.at : null);
        const known = frameAt(b.frames, key.at).news[viewerA];
        const news = b.frames.find((frame) => frame.at > key.at && frame.news[viewerA] !== null && frame.news[viewerA] !== known);
        shown.push(news && seen ? seen.at - news.at : null);
      }
      // Progress through the punch (0 at the press, 1 at contact, 2 at the end of the active phase, 3 when
      // recovered), so a change in the server's timing is not mistaken for the glove going back.
      const rewinds = punchKeys.map((key) => {
        const window = a.frames.filter((frame) => frame.at > key.at && frame.at < key.at + 900 && frame.fighters[viewerA].active);
        let worst = 0; let at = null;
        for (let index = 1; index < window.length; index += 1) {
          const drop = window[index - 1].fighters[viewerA].progress - window[index].fighters[viewerA].progress;
          if (drop > worst) { worst = drop; at = Math.round(window[index].at - key.at); }
        }
        return { progress: Number(worst.toFixed(2)), atMs: at };
      });
      const timings = [...new Set(a.frames.filter((frame) => frame.fighters[viewerA].active).map((frame) => frame.fighters[viewerA].timing))];
      note('punch timings seen on the puncher (startup/active/recovery):', JSON.stringify(timings));
      // Glove-to-hit gap: when the puncher's glove is at full extension versus when the opponent's head reacts on the same screen.
      const contacts = punchKeys.map((key) => {
        const hand = key.code === 'KeyU' ? 'right' : 'left';
        const window = a.frames.filter((frame) => frame.at > key.at && frame.at < key.at + 900);
        if (window.length === 0) return null;
        const rest = frameAt(a.frames, key.at).fighters[viewerA][hand];
        let reach = 0; let extended = null;
        for (const frame of window) { const d = distance(frame.fighters[viewerA][hand], rest); if (d > reach) { reach = d; extended = frame.at; } }
        return extended === null ? null : Math.round(extended - key.at);
      });
      note('own glove fully extended, ms after the key:', JSON.stringify(contacts), '| median', median(contacts));
      note('punch keys measured:', punchKeys.length, 'of', presses.length);
      const sends = await A.page.evaluate(() => window.__actionSends ?? []);
      const sent = punchKeys.map((key) => { const at = sends.find((time) => time >= key.at); return at === undefined ? null : Math.round(at - key.at); });
      note('press leaves the page, ms after the key:', JSON.stringify(sent), '| median', median(sent));
      if (sent.some((ms) => ms === null || ms > 25)) report.errors.push(`a press waited for the periodic input flush: ${JSON.stringify(sent)}`);
      note('own punch rewinds (progress the animation went back, and when):', JSON.stringify(rewinds));
      note('own punch starts on screen, ms:', JSON.stringify(local.map((v) => (v === null ? null : Math.round(v)))), '| median', median(local));
      note('own glove has moved 3 cm, ms:', JSON.stringify(moved.map((v) => (v === null ? null : Math.round(v)))), '| median', median(moved));
      note('opponent sees the punch start, ms:', JSON.stringify(remote.map((v) => (v === null ? null : Math.round(v)))), '| median', median(remote));
      note('of which waiting on the opponent\'s screen after the news arrived, ms:', JSON.stringify(shown.map((v) => (v === null ? null : Math.round(v)))), '| median', median(shown));
      note('opponent\'s playback delay, ticks:', JSON.stringify([...new Set(b.frames.map((frame) => frame.delay))]));
      const step = a.keys.find((key) => key.code === 'KeyA');
      if (step) {
        const before = frameAt(a.frames, step.at).fighters[viewerA];
        const own = a.frames.find((frame) => frame.at > step.at && Math.hypot(frame.fighters[viewerA].x - before.x, frame.fighters[viewerA].z - before.z) > 0.01);
        const beforeRemote = frameAt(b.frames, step.at).fighters[viewerA];
        const other = b.frames.find((frame) => frame.at > step.at && Math.hypot(frame.fighters[viewerA].x - beforeRemote.x, frame.fighters[viewerA].z - beforeRemote.z) > 0.01);
        note('own step starts on screen, ms:', own ? Math.round(own.at - step.at) : null, '| opponent sees it, ms:', other ? Math.round(other.at - step.at) : null);
      }
      const gaps = a.frames.slice(1).map((frame, index) => frame.at - a.frames[index].at);
      note('frames sampled:', a.frames.length, '| median frame ms:', median(gaps), '| stats', JSON.stringify(await A.page.evaluate(() => window.__handsApp?.networkStats?.inputLatencyMs ?? null)));
      const final = await waitFor(A.page, (s) => Boolean(s.final), 90000, 'final');
      note('FINAL:', JSON.stringify(final?.final ?? null).slice(0, 200));
    }

    if (scenario === 'clinch') {
      const fighters = (page) => page.evaluate(() => (window.__handsApp?.state?.snapshot?.fighters ?? []).map((f) => ({ id: f.player_id, x: f.x, y: f.y, clinch: f.clinch_ticks })));
      const gap = (list) => (list.length === 2 ? Math.round(Math.hypot(list[1].x - list[0].x, list[1].y - list[0].y)) : null);
      let started = Date.now();
      while (Date.now() - started < 15000) {
        const g = gap(await fighters(A.page));
        if (g !== null && g <= 95) break;
        await A.page.keyboard.down('d'); await B.page.keyboard.down('a'); await wait(150); await A.page.keyboard.up('d'); await B.page.keyboard.up('a');
      }
      note('gap before clinch:', gap(await fighters(A.page)));
      // Page evaluation and screenshots are slow under SwiftShader, so the page records the hold itself.
      await B.page.evaluate(() => {
        window.__clinchLog = [];
        window.__clinchTimer = setInterval(() => {
          const snapshot = window.__handsApp?.state?.snapshot;
          const f = snapshot?.fighters ?? [];
          if (f.length === 2) window.__clinchLog.push({ tick: snapshot.tick, gap: Math.round(Math.hypot(f[1].x - f[0].x, f[1].y - f[0].y)), clinch: f[0].clinch_ticks });
        }, 40);
      });
      await A.page.keyboard.press('b');
      await wait(600);
      for (let i = 0; i < 4; i += 1) await A.page.screenshot({ path: `${out}/e2e-clinch-A-${i}.png` });
      await wait(2000);
      const log = await B.page.evaluate(() => { clearInterval(window.__clinchTimer); return window.__clinchLog; });
      const firstHeld = log.findIndex((s) => s.clinch > 0);
      const held = log.filter((s) => s.clinch > 0);
      const afterBreak = firstHeld < 0 ? null : log.slice(firstHeld).find((s) => s.clinch === 0);
      note('clinch seen:', firstHeld >= 0, '| samples during hold:', held.length, '| gap on entry:', held[0]?.gap, '| min gap:', held.length ? Math.min(...held.map((s) => s.gap)) : null, '| last held gap:', held.at(-1)?.gap, '| gap after break:', afterBreak?.gap ?? null);
      note('status A:', (await status(A.page)).status, '| B:', (await status(B.page)).status);
      const final = await waitFor(A.page, (s) => Boolean(s.final), 90000, 'final');
      note('FINAL:', JSON.stringify(final?.final ?? null).slice(0, 200));
    }

    if (scenario === 'soak') {
      const sample = (page) => page.evaluate(() => ({
        heapMb: typeof performance.memory === 'object' && performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
        stats: window.__handsApp?.networkStats ?? null,
      }));
      const started = Date.now();
      const samples = [];
      let step = 0;
      let final = null;
      while (Date.now() - started < 8 * 60 * 1000) {
        const sA = await status(A.page);
        if (sA.final) { final = sA; break; }
        // A measured pace: a jab every few seconds behind a held guard keeps the bout going for three rounds.
        if (step % 4 === 0) await A.page.keyboard.press('f');
        if (step % 4 === 2) await B.page.keyboard.press('j');
        await A.page.keyboard.down('q'); await B.page.keyboard.down('q'); await wait(700); await A.page.keyboard.up('q'); await B.page.keyboard.up('q');
        if (step % 6 === 0) { await A.page.keyboard.down('d'); await B.page.keyboard.down('a'); await wait(200); await A.page.keyboard.up('d'); await B.page.keyboard.up('a'); }
        if (step % 7 === 3) { await A.page.keyboard.down('a'); await B.page.keyboard.down('d'); await wait(300); await A.page.keyboard.up('a'); await B.page.keyboard.up('d'); }
        await wait(400);
        step += 1;
        if (step % 18 === 0) {
          const [a, b] = [await sample(A.page), await sample(B.page)];
          samples.push({ t: Math.round((Date.now() - started) / 1000), a, b });
          note(`t=${samples.at(-1).t}s heap A ${a.heapMb} MB B ${b.heapMb} MB | latency A ${Math.round(a.stats?.inputLatencyMs ?? -1)} B ${Math.round(b.stats?.inputLatencyMs ?? -1)} | scale A ${a.stats?.resolutionScale} B ${b.stats?.resolutionScale} | ${sA.summary?.slice(0, 40)}`);
        }
      }
      if (final === null) final = await waitFor(A.page, (s) => Boolean(s.final), 60000, 'final');
      note('FINAL:', JSON.stringify(final?.final ?? null).slice(0, 220));
      if (samples.length >= 2) note('heap growth A:', samples.at(-1).a.heapMb - samples[0].a.heapMb, 'MB; B:', samples.at(-1).b.heapMb - samples[0].b.heapMb, 'MB over', samples.at(-1).t - samples[0].t, 's');
      await A.page.screenshot({ path: `${out}/e2e-soak-A-final.png` });
    }

    report.errors.push(...A.errors, ...B.errors);
  } finally {
    server.child.kill('SIGTERM');
    server.proxy?.close();
    await browser.close();
    const serverErrors = server.log.join('').split('\n').filter((l) => /error|warning|Traceback/i.test(l) && !/healthz/.test(l));
    if (scenario === 'cpu') {
      console.log('client errors:', JSON.stringify(report.errors.filter((e) => !/GL Driver/.test(e)).slice(0, 20), null, 1));
      console.log('server log lines of interest:', JSON.stringify(serverErrors.slice(0, 20), null, 1));
    }
  }
  if (scenario === 'cpu') return;
  const serverErrors = server.log.join('').split('\n').filter((l) => /error|warning|Traceback/i.test(l) && !/healthz/.test(l));
  console.log('client errors:', JSON.stringify(report.errors.filter((e) => !/GL Driver/.test(e)).slice(0, 20), null, 1));
  console.log('server log lines of interest:', JSON.stringify(serverErrors.slice(0, 20), null, 1));
}

/** One player calls in the computer from the waiting screen and boxes it to the result card. */
async function runCpu(A, note) {
  const level = process.env.E2E_CPU_LEVEL || 'contender';
  const picker = await A.page.waitForSelector('[data-cpu]:not([hidden])', { timeout: 60000 });
  note('computer offered while waiting:', picker !== null, '|', (await status(A.page)).status);
  await A.page.screenshot({ path: `${out}/e2e-cpu-waiting.png` });
  await A.page.click(`[data-cpu-level="${level}"]`);
  note('asked for:', level, '|', (await status(A.page)).status);
  await A.page.waitForSelector('[data-style-picker]:not([hidden])', { timeout: 30000 });
  note('the computer has picked:', (await pickerState(A.page))?.status);
  await A.page.keyboard.press('Enter');
  const started = await waitFor(A.page, (s) => /\. fight\./.test(s.summary ?? ''), 30000, 'fight phase');
  note('bout started against:', /computer opponent/.test(started?.summary ?? '') ? 'the computer' : 'someone else', '|', started?.summary?.slice(0, 160));
  const begun = Date.now();
  let final = null; let downs = 0; let shots = 0; let rested = false; let cornered = null;
  while (Date.now() - begun < 240000) {
    const s = await status(A.page);
    if (s.final) { final = s; break; }
    if (/\. rest\./.test(s.summary ?? '')) {
      // Between rounds the computer gives its corner an instruction like a player does.
      rested = true;
      const choice = await A.page.evaluate(() => window.__handsApp?.state?.snapshot?.fighters.find((fighter) => fighter.player_id.startsWith('cpu:'))?.corner_choice ?? null);
      if (choice !== null && choice !== 'balanced') cornered = choice;
      await wait(250);
      continue;
    }
    if (/You are down/.test(s.summary ?? '')) {
      const press = /Press left/.test(s.summary) ? 'ArrowLeft' : /Press right/.test(s.summary) ? 'ArrowRight' : null;
      if (press) { await A.page.keyboard.press(press); downs += 1; }
      await wait(120);
      continue;
    }
    // A plain plan: step in, jab and follow with a right, keep the guard up between.
    await A.page.keyboard.down('d'); await wait(150); await A.page.keyboard.up('d');
    await A.page.keyboard.press('f'); await wait(120); await A.page.keyboard.press(['u', 'h', 'y'][shots % 3]);
    await A.page.keyboard.down('q'); await wait(450); await A.page.keyboard.up('q');
    if (shots % 10 === 4) await A.page.screenshot({ path: `${out}/e2e-cpu-bout-${shots}.png` });
    shots += 1;
  }
  note('get-up presses:', downs);
  note('computer corner instruction in the rest:', rested ? (cornered ?? 'none (a forgetful corner, or the rest was missed)') : 'no rest reached');
  if (rested && cornered === null && level === 'champion') A.errors.push('the champion gave its corner no instruction');
  if (final === null) final = await waitFor(A.page, (s) => Boolean(s.final), 120000, 'final');
  note('FINAL:', final?.final);
  for (let i = 0; i < 80; i += 1) { if (await A.page.evaluate(() => window.__handsApp?.renderer?.resultVisible ?? false)) break; await wait(250); }
  await wait(800);
  await A.page.screenshot({ path: `${out}/e2e-cpu-result.png` });
  note('result card shown:', await A.page.evaluate(() => window.__handsApp?.renderer?.resultVisible ?? false), '| status:', (await status(A.page)).status);
  const rematch = await A.page.waitForSelector('[data-rematch]:not([disabled]):not([hidden])', { timeout: 30000 }).catch(() => null);
  note('rematch offered:', rematch !== null);
  if (rematch !== null) {
    await A.page.click('[data-rematch]');
    await settleStyle(A.page);
    const again = await waitFor(A.page, (s) => /countdown|\. fight\./.test(s.summary ?? '') && !s.final, 60000, 'rematch start');
    note('rematch against the computer started:', /computer opponent/.test(again?.summary ?? ''));
  }
}

/** Alpha picks with the keyboard and Bravo by touch while Charlie watches; the bout starts once both settle. */
async function pickStyles(A, B, open, note, report) {
  await Promise.all([A.page.waitForSelector('[data-style-picker]:not([hidden])', { timeout: 60000 }), B.page.waitForSelector('[data-style-picker]:not([hidden])', { timeout: 60000 })]);
  note('pick shown to Alpha:', JSON.stringify(await pickerState(A.page)));
  const C = await open('Charlie');
  await C.page.waitForSelector('[data-style-picker]:not([hidden])', { timeout: 30000 });
  await C.page.keyboard.press('Digit3');
  const watching = await pickerState(C.page);
  note('pick shown to the spectator:', JSON.stringify(watching));
  if (watching?.disabled !== 5 || watching.chosen !== null) report.errors.push('the spectator could pick a style');
  await A.page.keyboard.press('ArrowRight');
  await A.page.keyboard.press('ArrowRight');
  note('Alpha moves to:', (await pickerState(A.page))?.chosen);
  await A.page.keyboard.press('Enter');
  let heard = null;
  for (let i = 0; i < 40 && heard === null; i += 1) { const state = await pickerState(B.page); if (/Alpha: Slugger/.test(state?.status ?? '')) heard = state; else await wait(250); }
  note('Bravo hears:', heard?.status ?? 'nothing');
  if (heard === null) report.errors.push("Bravo never saw Alpha's settled style");
  note('the spectator hears:', (await pickerState(C.page))?.status);
  await A.page.screenshot({ path: `${out}/e2e-styles-A-pick.png` });
  await B.page.screenshot({ path: `${out}/e2e-styles-B-pick.png` });
  await B.page.tap('[data-style="swarmer"]');
  const started = await waitFor(A.page, (s) => /countdown|\. fight\./.test(s.summary ?? ''), 20000, 'bout start after the pick');
  note('bout started once both settled:', started !== null);
  await wait(600);
  await A.page.screenshot({ path: `${out}/e2e-styles-A-intro.png` });
  const styles = await A.page.evaluate(() => { const state = window.__handsApp?.state; return state?.snapshot?.fighters.map((fighter) => `${state.players[fighter.player_id]?.name}:${fighter.style}`) ?? null; });
  note('styles in the bout:', JSON.stringify(styles));
  if (JSON.stringify(styles) !== JSON.stringify(['Alpha:slugger', 'Bravo:swarmer'])) report.errors.push(`unexpected styles in the bout: ${JSON.stringify(styles)}`);
  const remembered = [await A.page.evaluate(() => localStorage.getItem('hands.style.v1')), await B.page.evaluate(() => localStorage.getItem('hands.style.v1'))];
  note('remembered for next time:', JSON.stringify(remembered));
  if (remembered[0] !== 'slugger' || remembered[1] !== 'swarmer') report.errors.push(`styles not remembered: ${JSON.stringify(remembered)}`);
  note('pick hidden once the bout began:', (await pickerState(A.page))?.hidden, (await pickerState(C.page))?.hidden);
  report.errors.push(...C.errors);
  await C.context.close();
}

main().catch((e) => { console.error('ERR', e.stack || e.message); process.exit(1); });
