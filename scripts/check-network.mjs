#!/usr/bin/env node
/**
 * 网络体检：逐个打开组件，拦截并记录所有指向外部的请求。
 *
 * 这个库要能离线用。任何指向外网的请求在离线时都会失败，表现就是
 * 「图不显示」「字体不对」，更隐蔽的是「改某个参数后组件坏掉，重置才恢复」——
 * 因为那个参数触发了重新加载外部资源。
 *
 * 用法：node scripts/check-network.mjs [--from 0] [--to 139] [--offline]
 *   --offline 直接阻断外部请求，模拟断网，看组件会坏成什么样
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const num = (f, d) => (argv.includes(f) ? Number(argv[argv.indexOf(f) + 1]) : d);
const OFFLINE = argv.includes('--offline');

const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'prompts/props.json'), 'utf8'));
const names = schema.components.map(c => c.name).slice(num('--from', 0), num('--to', 1e9));

const BATCH = 15;
let browser = null;
let page = null;
let hits = [];

async function fresh() {
  if (browser) await browser.close().catch(() => {});
  browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, permissions: ['camera'] });
  page = await ctx.newPage();

  // 拦截一切非本机请求
  await page.route('**/*', route => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url) || url.startsWith('data:') || url.startsWith('blob:')) {
      return route.continue();
    }
    hits.push(url);
    if (OFFLINE) return route.abort('internetdisconnected');
    return route.continue();
  });

  await page.goto('http://localhost:5180', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
}

await fresh();
const report = [];

for (const [i, name] of names.entries()) {
  if (i > 0 && i % BATCH === 0) await fresh();
  hits = [];
  try {
    await page.locator(`.pg-item[data-name="${name}"]`).first().click({ timeout: 12000 });
  } catch {
    continue;
  }
  await page.waitForTimeout(2000);

  // 再动一动参数，看会不会触发新的外部请求（这是「改参数后坏掉」的关键）
  const beforeParam = hits.length;
  const sliders = await page.locator('[role="slider"]').all();
  if (sliders.length) {
    const box = await sliders[0].boundingBox().catch(() => null);
    if (box) {
      await page.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2);
      await page.waitForTimeout(1200);
    }
  }
  const onParamChange = hits.length - beforeParam;

  if (hits.length) {
    const uniq = [...new Set(hits.map(u => u.replace(/\?.*$/, '').slice(0, 70)))];
    report.push({ name, total: hits.length, onParamChange, urls: uniq });
    console.log(
      `${name.padEnd(18)} ${String(hits.length).padStart(3)} 次外部请求` +
        (onParamChange ? `（改参数后又发了 ${onParamChange} 次）` : '') +
        `\n    ${uniq.slice(0, 3).join('\n    ')}`
    );
  }
}

await browser.close().catch(() => {});
fs.writeFileSync(path.join(ROOT, '.cache/network.json'), JSON.stringify(report, null, 2));

console.log(`\n=== ${names.length} 个组件里，${report.length} 个会请求外部资源 ===`);
const onChange = report.filter(r => r.onParamChange > 0);
if (onChange.length) {
  console.log(`\n其中「改参数会重新请求」的 ${onChange.length} 个 —— 这类在离线时改参数就会坏：`);
  for (const r of onChange) console.log(`  ${r.name}（${r.onParamChange} 次）`);
}
