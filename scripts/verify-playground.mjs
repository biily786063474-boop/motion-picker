#!/usr/bin/env node
/**
 * 交互验证：真的去拖滑块 / 选下拉 / 点预览区，看参数是否传到组件、复制按钮是否给出正确内容。
 * 截图落在 .cache/shots/ 供人工比对（静态截图证明不了调参生效，必须动一动）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.argv[2] || 'http://localhost:5180';
const SHOTS = path.join(ROOT, '.cache/shots');
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 2,
  permissions: ['clipboard-read', 'clipboard-write']
});
const page = await ctx.newPage();

const errors = [];
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', e => errors.push(e.message));

await page.goto(URL, { waitUntil: 'networkidle' });

// 列表项的可访问名是「组件名 + 依赖」，不能用 exact
const pick = async name => {
  await page.locator(`.pg-item[data-name="${name}"]`).first().click();
  await page.waitForTimeout(900);
};
const stage = () => page.locator('.pg-stage-inner');
const shot = (n) => stage().screenshot({ path: path.join(SHOTS, `${n}.png`) });

/** 点滑块轨道的某个百分比位置（PreviewSlider 用 pointerdown 取值） */
async function dragSlider(label, ratio) {
  const track = page.locator(`[role="slider"][aria-label="${label}"]`);
  const box = await track.boundingBox();
  await page.mouse.click(box.x + box.width * ratio, box.y + box.height / 2);
  await page.waitForTimeout(700);
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/* 1. Orb：改 hue，颜色应该整体变化 */
await pick('Orb');
await shot('x1-orb-hue-default');
await dragSlider('hue', 0.55);
await shot('x2-orb-hue-changed');
const hueVal = await page.locator('[role="slider"][aria-label="hue"]').getAttribute('aria-valuenow');
check('Orb hue 滑块可拖动', Number(hueVal) > 100, `aria-valuenow=${hueVal}`);

/* 2. SplitText：改文字 + 换 splitType */
await pick('SplitText');
await page.locator('.scrubber input[type="text"]').first().fill('参数真的生效了');
await page.waitForTimeout(1400);
await shot('x3-splittext-text-changed');
const shown = await stage().innerText();
check('SplitText text 传到组件', shown.replace(/\s/g, '').includes('参数真的生效了'), `预览区文字="${shown.trim().slice(0, 24)}"`);

/* 3. SplitText 的 select（从 description 挖出来的枚举）真的能选 */
await page.locator('.scrubber').filter({ hasText: 'splitType' }).locator('button').first().click();
await page.waitForTimeout(300);
const options = page.locator('.scrubber-dropdown-item'); // 下拉是 portal 到 body 的
const optionCount = await options.count();
if (optionCount) {
  await options.filter({ hasText: /^words$/ }).first().click();
  await page.waitForTimeout(1200);
}
await shot('x4-splittext-splittype-words');
check('splitType 下拉可展开并选中', optionCount >= 3, `选项数=${optionCount}`);

/* 4. ClickSpark：点预览区应出现火花（动画只有 400ms，点完立刻截） */
await pick('ClickSpark');
const box = await stage().boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(120);
await shot('x5-clickspark-clicked');
check('ClickSpark 可点击（截图人工确认火花）', true, '见 x5-clickspark-clicked.png');

/* 5. SpotlightCard：hover 到左上角，聚光应跟随 */
await pick('SpotlightCard');
const cardBox = await stage().boundingBox();
await page.mouse.move(cardBox.x + cardBox.width * 0.25, cardBox.y + cardBox.height * 0.25);
await page.waitForTimeout(500);
await shot('x6-spotlightcard-hover');
check('SpotlightCard 可 hover（截图人工确认聚光）', true, '见 x6-spotlightcard-hover.png');

/* 6. 复制按钮：改过的参数要出现在「复制用法」里 */
await pick('Orb');
await dragSlider('hue', 0.55);
await page.getByRole('button', { name: '复制用法' }).click();
await page.waitForTimeout(400);
const usage = await page.evaluate(() => navigator.clipboard.readText());
check('复制用法包含改过的参数', /hue=\{\d+\}/.test(usage), usage.replace(/\n/g, ' ').slice(0, 80));

await page.getByRole('button', { name: '复制 Prompt' }).click();
await page.waitForTimeout(400);
const prompt = await page.evaluate(() => navigator.clipboard.readText());
const local = fs.readFileSync(path.join(ROOT, 'prompts/Backgrounds/Orb-TS-TW.md'), 'utf8');
check('复制 Prompt 与 prompts/ 里的文件一致', prompt === local, `${prompt.length} 字符`);

await browser.close();

console.log(`\n控制台报错：${errors.length ? errors.length + ' 条' : '无'}`);
for (const e of errors.slice(0, 5)) console.log('  ' + e.slice(0, 200));
const failed = results.filter(r => !r.ok);
console.log(failed.length ? `\n${failed.length} 项未通过` : '\n全部通过');
process.exitCode = failed.length || errors.length ? 1 : 0;
