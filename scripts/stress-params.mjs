#!/usr/bin/env node
/**
 * 参数压力测试：把每个滑块拖到极值，看组件会不会坏掉（崩溃 / 内容消失 / 画面变空）。
 *
 * 用户反馈「拉动某个参数后要重新重载预设才能恢复正常显示」——
 * 说明存在某些参数值会让组件进入坏状态，而 debounce 重挂也救不回来。
 * 这个脚本就是把这些值找出来。
 *
 * 用法：node scripts/stress-params.mjs [--from 0] [--to 139] [--only Orb,Aurora]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const num = (f, d) => (argv.includes(f) ? Number(argv[argv.indexOf(f) + 1]) : d);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;

const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'prompts/props.json'), 'utf8'));
let names = schema.components.map(c => c.name).slice(num('--from', 0), num('--to', 1e9));
if (only) names = names.filter(n => only.includes(n));

const BATCH = 12;
let browser = null;
let page = null;
let errs = [];

async function fresh() {
  if (browser) await browser.close().catch(() => {});
  browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, permissions: ['camera'] });
  page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  await page.goto('http://localhost:5180', { waitUntil: 'networkidle' });
}

/** 画面「信息量」：唯一色数 + 亮度标准差。组件坏掉时这两个值会塌到接近 0 */
function info(buf) {
  const png = PNG.sync.read(buf);
  const colors = new Set();
  const lums = [];
  for (let i = 0; i < png.data.length; i += 4 * 53) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
    lums.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
  }
  const mean = lums.reduce((a, b) => a + b, 0) / lums.length;
  const sd = Math.sqrt(lums.reduce((a, b) => a + (b - mean) ** 2, 0) / lums.length);
  return { colors: colors.size, sd: +sd.toFixed(2) };
}

const stage = () => page.locator('.pg-stage-inner');
const snapshot = async () => {
  const buf = await stage().screenshot();
  const kids = await page.evaluate(() => document.querySelector('.pg-stage-inner')?.querySelectorAll('*').length ?? 0);
  const crash = await page.locator('.pg-crash').count();
  return { ...info(buf), kids, crash: crash > 0 };
};

/** 明显比基线差：崩了、节点掉光、或者画面信息量塌了 */
const broke = (base, now) =>
  now.crash ||
  (base.kids > 2 && now.kids <= 1) ||
  (base.colors > 8 && now.colors <= 3 && base.sd > 2 && now.sd < 1);

await fresh();
const findings = [];

for (const [i, name] of names.entries()) {
  if (i > 0 && i % BATCH === 0) await fresh();
  errs = [];
  try {
    await page.locator(`.pg-item[data-name="${name}"]`).first().click({ timeout: 12000 });
  } catch {
    console.log(`${name.padEnd(18)} 跳过（点不到）`);
    continue;
  }
  await page.waitForTimeout(1800);
  const base = await snapshot();
  if (base.crash) {
    console.log(`${name.padEnd(18)} 基线就是坏的，跳过`);
    continue;
  }

  const sliders = await page.locator('[role="slider"]').all();
  const bad = [];

  for (const s of sliders) {
    const label = await s.getAttribute('aria-label');
    const box = await s.boundingBox().catch(() => null);
    if (!box) continue;

    for (const [where, ratio] of [['最大', 0.995], ['最小', 0.005]]) {
      await page.mouse.click(box.x + box.width * ratio, box.y + box.height / 2);
      await page.waitForTimeout(900); // 等 debounce 重挂完成
      const now = await snapshot();
      if (broke(base, now)) {
        const val = await s.getAttribute('aria-valuenow');
        bad.push(`${label}=${val}(${where})`);
        // 复位，避免影响后续滑块的判断
        await page.getByRole('button', { name: '重置为默认值' }).click();
        await page.waitForTimeout(900);
        break;
      }
    }
  }

  if (bad.length) {
    findings.push({ name, bad, errors: [...new Set(errs)].slice(0, 2) });
    console.log(`${name.padEnd(18)} ✗ ${bad.join(' , ')}`);
  } else {
    console.log(`${name.padEnd(18)} ✓ ${sliders.length} 个滑块极值都稳`);
  }
}

await browser.close().catch(() => {});
fs.writeFileSync(path.join(ROOT, '.cache/stress.json'), JSON.stringify(findings, null, 2));
console.log(`\n=== 测了 ${names.length} 个组件，${findings.length} 个存在会把自己搞坏的参数 ===`);
for (const f of findings) console.log(`  ${f.name}: ${f.bad.join(' , ')}`);
