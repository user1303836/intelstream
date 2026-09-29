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
 *   node scripts/hands_e2e_scenarios.js ko|reconnect|rest|spectator|touch|mash|latency
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
