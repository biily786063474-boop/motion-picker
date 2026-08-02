#!/usr/bin/env node
/**
 * 全量巡检：逐个打开 139 个组件，记录渲染结果、报错、可见像素占比，并截图。
 * 产出 .cache/sweep.json（给后续分批人工/agent 复核用）+ .cache/shots/all/<name>.png
 *
 * 用法：node scripts/sweep-all.mjs [--from 0] [--to 139] [--shots]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const num = (flag, d) => (argv.includes(flag) ? Number(argv[argv.indexOf(flag) + 1]) : d);
const FROM = num('--from', 0);
const TO = num('--to', 1e9);
const SHOTS = path.join(ROOT, '.cache/shots/all');
fs.mkdirSync(SHOTS, { recursive: true });

const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'prompts/props.json'), 'utf8'));
const names = schema.components.map(c => c.name).slice(FROM, TO);

// 一路开下去会把 WebGL context 攒爆（实测第 105 个左右整个 tab 崩掉），每批换一个浏览器
const BATCH = num('--batch', 20);
let browser = null;
let page = null;
let bucket = [];

async function freshBrowser() {
  if (browser) await browser.close().catch(() => {});
  // ReflectiveCard 之类会调 getUserMedia，headless 默认没有媒体设备，直接报 NotSupportedError。
  // 挂一个假摄像头（绿色测试图案），让这类组件也能被巡检到。
  browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    permissions: ['camera']
  });
  page = await ctx.newPage();
  page.on('console', m => {
    if (m.type() === 'error') bucket.push(m.text().slice(0, 400));
  });
  page.on('pageerror', e => bucket.push(`[pageerror] ${e.message.slice(0, 400)}`));
  // --offline：阻断一切外部请求，模拟真实的离线使用场景。
  // 这个库的定位就是本地资产库，任何依赖外网才能显示的东西都算缺陷。
  if (argv.includes('--offline')) {
    await page.route('**/*', route => {
      const u = route.request().url();
      if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u) || u.startsWith('data:') || u.startsWith('blob:'))
        return route.continue();
      return route.abort('internetdisconnected');
    });
  }

  await page.goto('http://localhost:5180', { waitUntil: 'networkidle' });
}

await freshBrowser();

const results = [];
for (const [i, name] of names.entries()) {
  if (i > 0 && i % BATCH === 0) await freshBrowser();
  bucket = [];
  const t0 = Date.now();
  let row = { name, category: schema.components.find(c => c.name === name).category };

  try {
    await page.locator(`.pg-item[data-name="${name}"]`).first().click({ timeout: 15000 });
  } catch (e) {
    // tab 崩了就换一个浏览器重试一次，别让整轮巡检断在这
    if (/crash/i.test(e.message)) {
      await freshBrowser();
      try {
        await page.locator(`.pg-item[data-name="${name}"]`).first().click({ timeout: 15000 });
      } catch {
        row.status = 'crashed-browser';
        results.push(row);
        console.log(`${String(i + FROM).padStart(3)} ${name.padEnd(20)} ✗ 浏览器崩溃`);
        continue;
      }
    } else {
      row.status = 'no-list-item';
      results.push(row);
      console.log(`${String(i + FROM).padStart(3)} ${name.padEnd(20)} ✗ 列表里没有`);
      continue;
    }
  }

  // 等组件加载 + 动画起来
  await page.waitForTimeout(1800);

  // 光标跟随类（Crosshair / CursorGrid / Ribbons / SplashCursor / LaserFlow…）不动鼠标就一个像素都不画，
  // 静态截图会全黑，看起来像坏了。这里在预览区里走一段轨迹再点一下，让这类组件把效果画出来。
  const stageBox = await page.locator('.pg-stage-inner').boundingBox().catch(() => null);
  if (stageBox) {
    const cx = stageBox.x + stageBox.width / 2;
    const cy = stageBox.y + stageBox.height / 2;
    await page.mouse.move(cx - stageBox.width * 0.3, cy - stageBox.height * 0.2);
    for (let s = 1; s <= 8; s++) {
      await page.mouse.move(cx - stageBox.width * 0.3 + (stageBox.width * 0.6 * s) / 8, cy + Math.sin(s) * stageBox.height * 0.15);
      await page.waitForTimeout(45);
    }
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(400);
  }

  const crash = await page.locator('.pg-crash').count();
  const runtimeErr = await page.locator('.pg-runtime-error').count();
  row.crashed = crash > 0;
  if (crash) row.crashText = (await page.locator('.pg-crash').innerText()).replace(/\s+/g, ' ').slice(0, 300);
  if (runtimeErr) row.runtimeText = (await page.locator('.pg-runtime-error').innerText()).replace(/\s+/g, ' ').slice(0, 300);

  // 预览区里到底有没有东西：统计非背景色像素占比
  row.ink = await page.evaluate(async () => {
    const el = document.querySelector('.pg-stage-inner');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 5 || r.height < 5) return { w: r.width, h: r.height, ratio: 0, note: 'zero-size' };
    // 用 canvas / svg / 子元素数量粗判，像素级判断交给截图
    const canvases = el.querySelectorAll('canvas').length;
    const svgs = el.querySelectorAll('svg').length;
    const kids = el.querySelectorAll('*').length;
    const text = (el.innerText || '').trim().length;
    return { w: Math.round(r.width), h: Math.round(r.height), canvases, svgs, kids, text };
  });

  const panel = await page.locator('.pg-pane--props .pg-pane-title').first().textContent();
  row.panel = String(panel).trim();
  row.errors = [...new Set(bucket)].slice(0, 4);
  row.ms = Date.now() - t0;
  row.status = row.crashed ? 'crash' : row.errors.length ? 'error' : 'ok';

  if (argv.includes('--shots')) {
    await page.locator('.pg-stage-inner').screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
  }

  results.push(row);
  const mark = row.status === 'ok' ? '✓' : row.status === 'crash' ? '✗' : '⚠';
  const detail = row.crashed
    ? row.crashText?.slice(0, 90)
    : row.errors.length
      ? row.errors[0].slice(0, 90)
      : `${row.ink?.kids ?? 0} 节点 / ${row.ink?.canvases ?? 0} canvas`;
  console.log(`${String(i + FROM).padStart(3)} ${name.padEnd(20)} ${mark} ${detail}`);
}

await browser.close().catch(() => {});

fs.writeFileSync(path.join(ROOT, '.cache/sweep.json'), JSON.stringify(results, null, 2));

const by = s => results.filter(r => r.status === s).length;
console.log(`\n=== ${results.length} 个组件 ===`);
console.log(`正常 ${by('ok')} · 报错 ${by('error')} · 崩溃 ${by('crash')} · 列表缺失 ${by('no-list-item')}`);
const suspicious = results.filter(r => r.status === 'ok' && (r.ink?.kids ?? 0) <= 2 && !(r.ink?.canvases > 0));
if (suspicious.length) {
  console.log(`\n可能是空白的（节点数 ≤2 且无 canvas）${suspicious.length} 个：`);
  console.log('  ' + suspicious.map(r => r.name).join(', '));
}
