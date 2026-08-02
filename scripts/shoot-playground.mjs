#!/usr/bin/env node
/**
 * 打开 playground 逐个组件截图 + 抓控制台报错，用于人工核对渲染效果。
 * 用法：node scripts/shoot-playground.mjs [--url http://localhost:5180] [组件名 ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const urlIdx = argv.indexOf('--url');
const URL = urlIdx >= 0 ? argv[urlIdx + 1] : 'http://localhost:5180';
const names = argv.filter((a, i) => !a.startsWith('--') && i !== urlIdx + 1);
const targets = names.length ? names : ['Orb', 'SplitText', 'MagicBento', 'ClickSpark', 'SpotlightCard'];

const SHOTS = path.join(ROOT, '.cache/shots');
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });

const errors = [];
page.on('console', m => m.type() === 'error' && errors.push(`[console] ${m.text()}`));
page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });

for (const name of targets) {
  const before = errors.length;
  await page.getByRole('button', { name, exact: false }).first().click();
  await page.waitForTimeout(1800); // 等 WebGL / gsap 起来
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  const fresh = errors.slice(before);
  const panel = await page.locator('.pg-pane--props .pg-pane-title').first().textContent();
  console.log(`${name.padEnd(14)} ${String(panel).trim()}${fresh.length ? `   ⚠ ${fresh.length} 个报错` : ''}`);
  for (const e of fresh) console.log('    ' + e.slice(0, 220));
}

await browser.close();
console.log(`\n截图目录：${path.relative(ROOT, SHOTS)}`);
if (errors.length) process.exitCode = 1;
