/**
 * Two-player Hands scenarios through the real client and server, without Discord.
 *
 * Requires Playwright with Chromium (for example `npm install -g playwright && npx playwright
 * install chromium`, then run with NODE_PATH pointing at that global node_modules), a Vite dev
 * server started with HANDS_DEV_BACKEND=http://127.0.0.1:8091 (override with E2E_BASE), and uv.
 * Each scenario spawns scripts/hands_e2e_server.py on port 8091, drives two headless players with
 * keyboard or touch input, reads the client's screen-reader status text, and writes screenshots to
 * $TMPDIR/hands-e2e.
 *
 *   node scripts/hands_e2e_scenarios.js ko|reconnect|rest|spectator|touch|mash|latency|soak|background|rematch|rematchloop|clinch
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
const PORT = 8091;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function healthz() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/healthz`, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

/** TCP proxy that delays every chunk in both directions, so websocket frames see real latency. */
function delayProxy(listenPort, targetPort, delayMs) {
  const server = net.createServer((client) => {
    const upstream = net.connect(targetPort, '127.0.0.1');
    const pipe = (from, to) => {
      from.on('data', (chunk) => setTimeout(() => { if (!to.destroyed) to.write(chunk); }, delayMs));
      from.on('end', () => setTimeout(() => to.end(), delayMs));
      from.on('error', () => to.destroy());
    };
    pipe(client, upstream);
    pipe(upstream, client);
  });
  server.listen(listenPort, '127.0.0.1');
  return server;
}

async function startServer(args, { oneWayDelayMs = 0 } = {}) {
  const backendPort = oneWayDelayMs > 0 ? PORT + 1 : PORT;
  const child = spawn('uv', ['run', 'python', 'scripts/hands_e2e_server.py', '--port', String(backendPort), ...args], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  const proxy = oneWayDelayMs > 0 ? delayProxy(PORT, backendPort, oneWayDelayMs) : null;
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

async function main() {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const instance = `e2e-${scenario}-${Date.now()}`;
  const open = async (name, options = {}) => {
    const context = await browser.newContext(options.mobile ? { ...devices['Pixel 7'], viewport: { width: 844, height: 390 } } : { viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
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
  }[scenario];
  const server = await startServer(serverArgs, { oneWayDelayMs: scenario === 'latency' ? 110 : 0 });
  try {
    const A = await open('Alpha');
    const B = await open('Bravo', { mobile: scenario === 'touch' });
    if (scenario === 'latency') note('both clients behind a TCP proxy adding 110 ms each way (220 ms round trip) to every frame');
    const startedState = await waitFor(A.page, (s) => /countdown|fight/.test(s.summary ?? ''), 60000, 'bout start');
    note('bout started:', startedState !== null);
    await waitFor(A.page, (s) => /\. fight\./.test(s.summary ?? ''), 20000, 'fight phase');
    // Approach: A right, B left.
    await A.page.keyboard.down('d'); await B.page.keyboard.down('a'); await wait(1600); await A.page.keyboard.up('d'); await B.page.keyboard.up('a');

    if (scenario === 'ko') {
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
      await wait(4500);
      await A.page.screenshot({ path: `${out}/e2e-rest-A.png` }); await B.page.screenshot({ path: `${out}/e2e-rest-B.png` });
      const round2 = await waitFor(A.page, (s) => /Round 2\. fight/.test(s.summary ?? ''), 40000, 'round 2');
      note('round 2 reached:', round2 !== null, '|', round2?.summary?.slice(0, 60));
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
      const keys = ['f', 'j', 'r', 'u', 'g', 'h', 't', 'y', 'q', 'e', 'z', 'x', 'c', 'v'];
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
      const sample = (page) => page.evaluate(() => ({ heapMb: typeof performance.memory === 'object' && performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, gpu: window.__handsApp?.networkStats?.gpu ?? null }));
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
        const next = await waitFor(A.page, (s) => /countdown|\. fight\./.test(s.summary ?? '') && !s.final, 60000, `bout ${bout + 1} start`);
        note(`bout ${bout + 1} started: ${next !== null}`);
      }
      if (samples.length >= 2) {
        const first = samples[0]; const last = samples.at(-1);
        note('growth A: heap', last.a.heapMb - first.a.heapMb, 'MB; geometries', (last.a.gpu?.geometries ?? 0) - (first.a.gpu?.geometries ?? 0), '; textures', (last.a.gpu?.textures ?? 0) - (first.a.gpu?.textures ?? 0), '; programs', (last.a.gpu?.programs ?? 0) - (first.a.gpu?.programs ?? 0));
        note('growth B: heap', last.b.heapMb - first.b.heapMb, 'MB; geometries', (last.b.gpu?.geometries ?? 0) - (first.b.gpu?.geometries ?? 0), '; textures', (last.b.gpu?.textures ?? 0) - (first.b.gpu?.textures ?? 0), '; programs', (last.b.gpu?.programs ?? 0) - (first.b.gpu?.programs ?? 0));
      }
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
  }
  const serverErrors = server.log.join('').split('\n').filter((l) => /error|warning|Traceback/i.test(l) && !/healthz/.test(l));
  console.log('client errors:', JSON.stringify(report.errors.filter((e) => !/GL Driver/.test(e)).slice(0, 20), null, 1));
  console.log('server log lines of interest:', JSON.stringify(serverErrors.slice(0, 20), null, 1));
}

main().catch((e) => { console.error('ERR', e.stack || e.message); process.exit(1); });
