#!/usr/bin/env node
/**
 * 把 workflow 产出的语义卡片汇总进 prompts/semantic-annotations.json。
 *
 * 直接读 journal.jsonl，不依赖 workflow 的最终返回值（那个可能被截断）。
 * 可以指定多个 workflow 目录，后面的覆盖前面的（重跑某批时用得上）。
 *
 *   node scripts/collect-semantic.mjs <workflow 目录> [更多目录…]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(LIB, 'prompts/semantic-annotations.json');

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error('用法：node scripts/collect-semantic.mjs <workflow 目录> [...]');
  process.exit(1);
}

let existing = {};
try {
  existing = JSON.parse(fs.readFileSync(OUT, 'utf8'));
} catch {}

const cards = new Map(Object.entries(existing));
let fromReview = 0;

for (const dir of dirs) {
  const file = path.join(dir, 'journal.jsonl');
  if (!fs.existsSync(file)) {
    console.error(`跳过（没有 journal.jsonl）：${dir}`);
    continue;
  }
  for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const r = entry.result;
    if (!r || typeof r !== 'object') continue;

    // 标注 agent：{ cards: [...] }
    if (Array.isArray(r.cards)) {
      for (const c of r.cards) if (c?.name && c.summary) cards.set(c.name, c);
      continue;
    }
    // 校准 agent：{ name, accurate, corrected }
    if (typeof r.accurate === 'boolean' && r.name && !r.accurate && r.corrected?.summary) {
      cards.set(r.name, { ...(cards.get(r.name) || {}), ...r.corrected, name: r.name });
      fromReview++;
    }
  }
}

// 质量检查：空话式的 summary 挑出来
const vague = [];
for (const [name, c] of cards) {
  const s = String(c.summary || '');
  if (s.length < 12 || /^(一个|漂亮|炫酷|好看)的?(背景|效果|动画)$/.test(s.trim())) vague.push(name);
  if (!c.keywords?.length) vague.push(name);
}

const sorted = Object.fromEntries([...cards.entries()].sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2) + '\n');

console.log(`语义卡片 ${cards.size} 张已写入 ${path.relative(LIB, OUT)}`);
if (fromReview) console.log(`  其中 ${fromReview} 张来自校准阶段的修正`);
if (vague.length) console.error(`  ⚠ ${vague.length} 张质量存疑（描述太短或缺关键词）：${[...new Set(vague)].slice(0, 10).join(' ')}`);
console.log(`\n下一步：node scripts/build-semantic.mjs  把标注合并进语义索引`);
