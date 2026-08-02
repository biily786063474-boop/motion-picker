#!/usr/bin/env node
/**
 * 真正的空白检测：直接看截图像素，而不是数 DOM 节点。
 *
 * 巡检脚本按「有没有 canvas / 多少个节点」判断，会漏掉 Lanyard 这种
 * ——canvas 在、不报错、但 WebGL 一个像素都没画出来。
 *
 * 判据：把图缩成网格采样，统计唯一颜色数和亮度标准差。
 * 一张有内容的图，这两个值都不会太低。
 *
 * 用法：node scripts/detect-blank.mjs [--dir .cache/shots/all] [--verbose]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const DIR = path.resolve(ROOT, argv.includes('--dir') ? argv[argv.indexOf('--dir') + 1] : '.cache/shots/all');

/** 网格采样，返回唯一色数 / 亮度标准差 / 非背景像素占比 */
function analyze(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width, height, data } = png;
  const stepX = Math.max(1, Math.floor(width / 120));
  const stepY = Math.max(1, Math.floor(height / 120));

  const colors = new Set();
  const lums = [];
  // 左上角像素当作背景色基准（预览容器的底色）
  const bg = [data[0], data[1], data[2]];
  let nonBg = 0;
  let total = 0;

  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const i = (width * y + x) << 2;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      // 量化到 5 位，避免抗锯齿噪点撑起唯一色数
      colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
      lums.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
      if (Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) > 24) nonBg++;
      total++;
    }
  }

  const mean = lums.reduce((a, b) => a + b, 0) / lums.length;
  const sd = Math.sqrt(lums.reduce((a, b) => a + (b - mean) ** 2, 0) / lums.length);
  return { colors: colors.size, sd: +sd.toFixed(2), inkRatio: +(nonBg / total).toFixed(4), width, height };
}

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.png')).sort();
const rows = [];
for (const f of files) {
  try {
    rows.push({ name: path.basename(f, '.png'), ...analyze(path.join(DIR, f)) });
  } catch (e) {
    rows.push({ name: path.basename(f, '.png'), error: e.message.slice(0, 60) });
  }
}

// 空白 = 几乎单色且几乎没有偏离背景的像素
const isBlank = r => !r.error && r.colors <= 6 && r.sd < 3 && r.inkRatio < 0.01;
const isFaint = r => !r.error && !isBlank(r) && (r.inkRatio < 0.02 || r.sd < 6);

const blank = rows.filter(isBlank);
const faint = rows.filter(isFaint);

console.log(`分析 ${rows.length} 张截图`);
console.log(`\n空白（几乎纯色）${blank.length} 个：`);
for (const r of blank) console.log(`  ${r.name.padEnd(20)} 色数=${r.colors} 标准差=${r.sd} 有效像素=${(r.inkRatio * 100).toFixed(2)}%`);
console.log(`\n内容很淡（可能有问题）${faint.length} 个：`);
for (const r of faint) console.log(`  ${r.name.padEnd(20)} 色数=${r.colors} 标准差=${r.sd} 有效像素=${(r.inkRatio * 100).toFixed(2)}%`);

if (argv.includes('--verbose')) {
  console.log('\n全部：');
  for (const r of rows.sort((a, b) => (a.inkRatio ?? 0) - (b.inkRatio ?? 0)))
    console.log(`  ${r.name.padEnd(20)} ${r.error || `色数=${String(r.colors).padStart(4)} sd=${String(r.sd).padStart(6)} ink=${(r.inkRatio * 100).toFixed(2)}%`}`);
}

fs.writeFileSync(path.join(ROOT, '.cache/blank-report.json'), JSON.stringify({ blank, faint, all: rows }, null, 2));
