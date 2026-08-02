#!/usr/bin/env node
/**
 * 隔离验证：在全新浏览器里直接打开某个组件（不经过任何其他组件），看它自己会不会报错。
 *
 * 巡检是顺序切换 139 个组件的，上一个组件卸载不干净（残留的 rAF 循环、全局监听）
 * 会把错误算到下一个头上。要判断「是它自己的问题还是被前一个连累」，只能隔离测。
 *
 * 用法：node scripts/verify-isolated.mjs Ferrofluid Lightfall [...]
 */
import { chromium } from 'playwright';

const names = process.argv.slice(2);
if (!names.length) {
  console.error('用法：node scripts/verify-isolated.mjs <组件名> [...]');
  process.exit(1);
}

for (const name of names) {
  // 每个组件一个全新浏览器，杜绝任何残留
  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('console', m => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message.slice(0, 200)}`));

  await page.goto('http://localhost:5180', { waitUntil: 'networkidle' });
  const beforeSelect = errors.length;

  await page.locator(`.pg-item[data-name="${name}"]`).first().click();
  await page.waitForTimeout(3000);

  const crash = await page.locator('.pg-crash').count();
  const fresh = errors.slice(beforeSelect);
  const ink = await page.evaluate(() => {
    const el = document.querySelector('.pg-stage-inner');
    return el ? { kids: el.querySelectorAll('*').length, canvas: el.querySelectorAll('canvas').length } : null;
  });

  const verdict = crash ? '崩溃' : fresh.length ? '有报错' : '干净';
  console.log(`${name.padEnd(16)} ${verdict.padEnd(6)} ${ink?.kids ?? '?'} 节点 / ${ink?.canvas ?? '?'} canvas`);
  for (const e of [...new Set(fresh)].slice(0, 3)) console.log(`    ${e}`);
  if (!fresh.length && !crash) console.log('    → 巡检里报的错不是它自己的，是被前一个组件的残留连累的');

  await browser.close();
}
