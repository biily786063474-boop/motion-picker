#!/usr/bin/env node
/**
 * hover 体检：找出「鼠标移上去没反应」的组件。
 *
 * 难点是很多组件有常驻动画，两张截图本来就不一样。所以用对照法：
 *   A  = 鼠标在预览区外
 *   B1 = 鼠标移到内容中心，等一会
 *   B2 = 鼠标不动，再等同样长时间     ← B1 vs B2 的差异 = 动画本身的噪声
 * 只有当 (A vs B1) 明显大于 (B1 vs B2) 时，才算 hover 真的起了作用。
 *
 * 用法：node scripts/check-hover.mjs [--from 0] [--to 139]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const num = (f, d) => (argv.includes(f) ? Number(argv[argv.indexOf(f) + 1]) : d);

const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'prompts/props.json'), 'utf8'));
const names = schema.components.map(c => c.name).slice(num('--from', 0), num('--to', 1e9));

/** 两张图的平均像素差 */
function diff(a, b) {
  const A = PNG.sync.read(a);
  const B = PNG.sync.read(b);
  if (A.width !== B.width || A.height !== B.height) return 999;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < A.data.length; i += 4 * 41) {
    sum += Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
    n++;
  }
  return +(sum / n / 3).toFixed(2);
}

const BATCH = 15;
let browser = null;
let page = null;

async function fresh() {
  if (browser) await browser.close().catch(() => {});
  browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, permissions: ['camera'] });
  page = await ctx.newPage();
  await page.goto('http://localhost:5180', { waitUntil: 'networkidle' });
}

await fresh();
const rows = [];

for (const [i, name] of names.entries()) {
  if (i > 0 && i % BATCH === 0) await fresh();
  try {
    await page.locator(`.pg-item[data-name="${name}"]`).first().click({ timeout: 12000 });
  } catch {
    continue;
  }
  await page.waitForTimeout(2000);

  const stage = page.locator('.pg-stage-inner');
  const box = await stage.boundingBox().catch(() => null);
  if (!box) continue;

  // A：鼠标远离预览区
  await page.mouse.move(60, 700);
  await page.waitForTimeout(700);
  const A = await stage.screenshot();

  // B1：移到内容中心
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await page.waitForTimeout(700);
  const B1 = await stage.screenshot();

  // B2：不动，再等一样久 —— 用来量出动画噪声
  await page.waitForTimeout(700);
  const B2 = await stage.screenshot();

  const hoverDiff = diff(A, B1);
  const noise = diff(B1, B2);
  // hover 效果要明显盖过动画噪声才算数
  const responds = hoverDiff > Math.max(noise * 2.2, 1.2);

  rows.push({ name, hoverDiff, noise, responds });
  if (!responds) console.log(`${name.padEnd(18)} 无反应  hover差=${hoverDiff}  噪声=${noise}`);
}

await browser.close().catch(() => {});
fs.writeFileSync(path.join(ROOT, '.cache/hover.json'), JSON.stringify(rows, null, 2));

const silent = rows.filter(r => !r.responds);
console.log(`\n=== 测了 ${rows.length} 个，${silent.length} 个鼠标移上去没有可见变化 ===`);
console.log('（注意：本来就不响应鼠标的组件也会落在这里，需要人工过一遍）');
