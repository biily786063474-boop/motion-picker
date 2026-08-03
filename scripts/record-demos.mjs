#!/usr/bin/env node
/**
 * 录 README 用的演示动图。
 *
 * 录的是选型台里组件的真实渲染（Playwright 录屏 → ffmpeg 转 GIF），
 * 不是生成的画面。
 *
 *   node scripts/record-demos.mjs           录组件效果
 *   node scripts/record-demos.mjs --flow     录完整工作流演示
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(LIB, 'docs/media');
const TMP = path.join(LIB, '.cache/rec');
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const URL = process.env.URL || 'http://localhost:5180';

/** 只留预览区，左右栏和标题栏都藏掉，录出来干净 */
const BARE_CSS = `
  .pg-pane--list, .pg-pane--props, .pg-stage-head, .pg-host-check { display: none !important; }
  .pg-app { grid-template-columns: 1fr !important; }
  .pg-stage { padding: 0 !important; }
  .pg-stage-inner { max-width: none !important; width: 100% !important; height: 100% !important;
                    border: none !important; border-radius: 0 !important; }
`;

/**
 * 转动态 WebP 而不是 GIF —— 同样的画质体积小一个数量级，
 * shader 类那种全屏渐变用 GIF 动辄 8~10MB，README 里会加载到崩溃。
 * GitHub 的 markdown 图片支持 animated webp。
 */
const toWebp = (webm, out, { fps = 14, width = 560, quality = 58 } = {}) => {
  execFileSync(
    'ffmpeg',
    ['-y', '-i', webm, '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos`,
     '-c:v', 'libwebp', '-lossless', '0', '-q:v', String(quality),
     '-preset', 'picture', '-loop', '0', '-an', '-vsync', '0', out],
    { stdio: 'pipe' }
  );
  return fs.statSync(out).size;
};

/* ---------- 组件效果 ---------- */
async function recordComponent({ name, seconds = 5, interact, size = { width: 900, height: 500 } }) {
  const dir = path.join(TMP, name);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir, size } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.locator(`.pg-item[data-name="${name}"]`).first().click();
  await page.waitForTimeout(2200);
  await page.addStyleTag({ content: BARE_CSS });
  await page.waitForTimeout(900);

  if (interact) await interact(page, size);
  else await page.waitForTimeout(seconds * 1000);

  await ctx.close();
  await browser.close();

  const webm = fs.readdirSync(dir).find(f => f.endsWith('.webm'));
  const out = path.join(OUT, `${name}.webp`);
  const bytes = toWebp(path.join(dir, webm), out, { width: 560 });
  console.log(`  ${name.padEnd(16)} ${(bytes / 1024 / 1024).toFixed(2)} MB`);
}

/** 鼠标在预览区里画圈 —— 光标驱动的效果不动鼠标就是一片黑 */
const circleMouse = (loops = 2, ms = 4000) => async (page, size) => {
  const cx = size.width / 2;
  const cy = size.height / 2;
  const r = Math.min(size.width, size.height) * 0.3;
  const steps = 60 * loops;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2 * loops;
    await page.mouse.move(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.7);
    await page.waitForTimeout(ms / steps);
  }
};

const clickAround = (times = 5, ms = 4000) => async (page, size) => {
  const spots = [
    [0.3, 0.35],
    [0.68, 0.3],
    [0.5, 0.6],
    [0.25, 0.7],
    [0.75, 0.65]
  ];
  for (let i = 0; i < times; i++) {
    const [x, y] = spots[i % spots.length];
    await page.mouse.move(size.width * x, size.height * y);
    await page.waitForTimeout(120);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(ms / times);
  }
};

/* ---------- 完整工作流 ---------- */
async function recordFlow() {
  const size = { width: 1440, height: 810 };
  const dir = path.join(TMP, 'flow');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir, size }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // 搜索 → 挑组件
  await page.locator('.pg-search').fill('text');
  await page.waitForTimeout(1200);
  await page.locator('.pg-item[data-name="SplitText"]').first().click();
  await page.waitForTimeout(2600);

  // 调参数：拖 duration
  const s = page.locator('[role="slider"][aria-label="duration"]');
  const box = await s.boundingBox();
  if (box) {
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(box.x + (box.width - 20) * (i / 20), box.y + box.height / 2);
      await page.waitForTimeout(45);
    }
    await page.mouse.up();
  }
  await page.waitForTimeout(2400);

  // 交给 AI
  await page.getByRole('button', { name: /交给 AI/ }).click();
  await page.waitForTimeout(2600);

  await ctx.close();
  await browser.close();

  const webm = fs.readdirSync(dir).find(f => f.endsWith('.webm'));
  const out = path.join(OUT, 'workflow.webp');
  const bytes = toWebp(path.join(dir, webm), out, { fps: 12, width: 880, quality: 62 });
  console.log(`  workflow         ${(bytes / 1024 / 1024).toFixed(2)} MB`);
}

/* ---------- 主流程 ---------- */
if (process.argv.includes('--flow')) {
  console.log('录工作流演示…');
  await recordFlow();
} else {
  console.log('录组件效果…');
  const list = [
    { name: 'LiquidEther', interact: circleMouse(2, 4500) },
    { name: 'Orb', interact: circleMouse(1.5, 4200) },
    { name: 'Silk', seconds: 4 },
    { name: 'SplitText', seconds: 4, size: { width: 900, height: 380 } },
    { name: 'ClickSpark', interact: clickAround(5, 4200) },
    { name: 'MagicBento', interact: circleMouse(1.5, 4500), size: { width: 900, height: 620 } },
    { name: 'Masonry', seconds: 4, size: { width: 900, height: 560 } },
    { name: 'Prism', seconds: 4 }
  ];
  for (const item of list) {
    try {
      await recordComponent(item);
    } catch (e) {
      console.log(`  ${item.name.padEnd(16)} 失败：${e.message.split('\n')[0].slice(0, 60)}`);
    }
  }
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n输出：${path.relative(LIB, OUT)}`);
