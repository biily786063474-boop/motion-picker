#!/usr/bin/env node
/**
 * 对账工具：用真实浏览器点 reactbits.dev 的「Copy Prompt」，
 * 读剪贴板内容与本地离线产物逐字节比对。
 *
 * 用法：node scripts/verify-against-site.mjs [组件路由 ...]
 *   默认抽检 backgrounds/orb、text-animations/split-text、components/magic-bento
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'prompts/index.json'), 'utf8'));

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['backgrounds/orb', 'text-animations/split-text', 'components/magic-bento'];

const browser = await chromium.launch();
const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });

let fail = 0;
for (const route of targets) {
  const url = `https://reactbits.dev/${route}`;
  const entry = index.components.find(c => c.url === url);
  if (!entry) {
    console.error(`✗ ${route}：index.json 中无此 URL`);
    fail++;
    continue;
  }

  const page = await ctx.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('preferredLanguage', 'TS');
    localStorage.setItem('preferredStyle', 'TW');
    // 关掉 React Bits Pro 公告弹窗，否则遮挡工具栏（见 AnnouncementModal.jsx STORAGE_KEY）
    localStorage.setItem('rb-pro-july-release-seen', 'true');
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // 点 Copy Prompt（工具栏按钮，窄屏时藏在 ⋯ 菜单里）
  const btn = page.locator('[aria-label="Copy AI prompt"]').first();
  await btn.waitFor({ state: 'visible', timeout: 30000 });
  // 万一仍有遮罩，先 Esc 一次
  const backdrop = page.locator('.announcement-modal-backdrop');
  if (await backdrop.count()) await page.keyboard.press('Escape');
  await btn.click({ timeout: 20000 });

  const live = await page.evaluate(() => navigator.clipboard.readText());
  await page.close();

  const localFile = path.join(ROOT, 'prompts', entry.prompt);
  const local = fs.readFileSync(localFile, 'utf8');

  if (live === local) {
    console.log(`✓ ${entry.name.padEnd(14)} 字节级一致（${Buffer.byteLength(local)} B）`);
  } else {
    fail++;
    console.error(`✗ ${entry.name} 不一致：线上 ${live.length} 字符 / 本地 ${local.length} 字符`);
    const a = live.split('\n');
    const b = local.split('\n');
    for (let i = 0, shown = 0; i < Math.max(a.length, b.length) && shown < 8; i++) {
      if (a[i] !== b[i]) {
        console.error(`  行 ${i + 1}\n    线上: ${JSON.stringify(a[i])}\n    本地: ${JSON.stringify(b[i])}`);
        shown++;
      }
    }
    fs.writeFileSync(path.join(ROOT, `.cache/${entry.name}-live.md`), live);
  }
}

await browser.close();
console.log(fail ? `\n${fail}/${targets.length} 项不一致` : `\n全部 ${targets.length} 项字节级一致`);
process.exit(fail ? 1 : 0);
