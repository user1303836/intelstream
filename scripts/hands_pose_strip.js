/**
 * Frame strips from the pose lab for reviewing motion, not just single poses.
 *
 * Requires Playwright with Chromium and pngjs on NODE_PATH (web/hands/node_modules has pngjs),
 * and the Vite dev server on http://localhost:5173. Renders the given pose frozen at each time
 * and writes the frames side by side.
 *
 *   node scripts/hands_pose_strip.js hook_left "0.15,0.27,0.37,0.45,0.52,0.6,0.72,0.9" strip.png "&cam=top"
 */
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const fs = require('node:fs');
const [,, pose, timesCsv, out, extra = ''] = process.argv;
const times = timesCsv.split(',').map(Number);
const SIZE = 420;
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  const strip = new PNG({ width: SIZE * times.length, height: SIZE });
  const debug = [];
  for (const [index, t] of times.entries()) {
    await page.goto(`http://localhost:5173/?model-lab=1&pose=${pose}&freeze=${t}${extra}`, { waitUntil: 'load' });
    await page.waitForTimeout(2600);
    const frame = PNG.sync.read(await page.screenshot({ type: 'png' }));
    for (let y = 0; y < SIZE; y += 1) frame.data.copy(strip.data, (y * strip.width + index * SIZE) * 4, y * frame.width * 4, (y * frame.width + SIZE) * 4);
    const info = await page.evaluate(() => window.__poseLab ?? null);
    debug.push({ t, gloveL: info?.gloveL, gloveR: info?.gloveR });
  }
  fs.writeFileSync(out, PNG.sync.write(strip));
  console.log(JSON.stringify(debug));
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
