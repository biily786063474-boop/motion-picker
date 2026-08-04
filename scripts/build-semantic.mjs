#!/usr/bin/env node
/**
 * 生成语义索引 prompts/semantic.json —— 让「暗色流动背景」这种需求能找到 Silk。
 *
 * 两层数据：
 *   traits   从源码客观推导（作用面/触发/技术/是否重）—— 这一层是事实，本脚本负责
 *   semantic 中文描述、气质、场景（长什么样、什么时候用）—— 这一层要看图判断，
 *            由 AI 标注后写进 custom-semantic.json，本脚本负责合并
 *
 * 分开是因为：traits 每次重跑都能重新算出来，semantic 是人/AI 的判断，要留住。
 *
 *   node scripts/build-semantic.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeTraits } from './lib/traits.mjs';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(LIB, 'prompts/semantic.json');
const ANNOTATIONS = path.join(LIB, 'prompts/semantic-annotations.json');

const idx = JSON.parse(fs.readFileSync(path.join(LIB, 'prompts/index.json'), 'utf8'));
const props = JSON.parse(fs.readFileSync(path.join(LIB, 'prompts/props.json'), 'utf8'));
const propsByName = new Map(props.components.map(c => [c.name, c.props]));

// AI 标注的中文语义层（没有就先空着，检索会退化成靠英文关键词）
let annotations = {};
try {
  annotations = JSON.parse(fs.readFileSync(ANNOTATIONS, 'utf8'));
} catch {}

/**
 * 自有组件可以在 meta.json 里直接写 semantic 块，不用等 AI 标注 —— 作者本人最清楚它长什么样。
 * 手写的优先级高于机器标注。
 */
let handWritten = 0;
const CUSTOM = path.join(LIB, 'custom');
if (fs.existsSync(CUSTOM)) {
  for (const cat of fs.readdirSync(CUSTOM)) {
    const catDir = path.join(CUSTOM, cat);
    if (!fs.statSync(catDir).isDirectory()) continue;
    for (const name of fs.readdirSync(catDir)) {
      const metaFile = path.join(catDir, name, 'meta.json');
      if (!fs.existsSync(metaFile)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        if (meta.semantic?.summary) {
          annotations[name] = { ...annotations[name], ...meta.semantic };
          handWritten++;
        }
      } catch {
        console.error(`  ⚠ ${cat}/${name}/meta.json 解析失败，跳过它的 semantic 块`);
      }
    }
  }
}

const entries = [];
for (const c of idx.components) {
  const file = path.join(LIB, c.localPath);
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  const traits = computeTraits(source, c, propsByName.get(c.name));
  const ann = annotations[c.name] || {};

  entries.push({
    name: c.name,
    category: c.category,
    // —— 客观特征（源码推导）——
    surface: traits.surface,
    triggers: traits.triggers,
    tech: traits.tech,
    heavy: traits.heavy,
    continuous: traits.continuous,
    interactive: traits.interactive,
    deps: c.realDeps,
    // —— 语义层（AI 标注，可能缺）——
    summary: ann.summary || c.description || '',
    mood: ann.mood || [],
    motion: ann.motion || '',
    palette: ann.palette || [],
    intensity: ann.intensity || null,
    scenes: ann.scenes || [],
    // 什么时候不该用它 —— 只有踩过才知道的坑，比「长什么样」更值钱
    avoid: ann.avoid || '',
    zh: ann.keywords || [],
    // 英文兜底词：从组件名和 prop 描述里捞的
    en: traits.keywords
  });
}

const annotated = entries.filter(e => e.summary).length;
fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      total: entries.length,
      annotated,
      note: '客观特征由 build-semantic.mjs 从源码推导；summary/mood/scenes 等语义层来自 semantic-annotations.json（AI 看图标注）',
      components: entries
    },
    null,
    2
  ) + '\n'
);

console.log(`语义索引已生成：${entries.length} 个组件`);
console.log(`  客观特征  ${entries.length}/${entries.length}（源码推导）`);
console.log(`  中文语义  ${annotated}/${entries.length}${annotated < entries.length ? '（缺的靠英文关键词兜底，检索质量会差）' : ''}`);
if (handWritten) console.log(`  其中 ${handWritten} 个来自 custom/*/meta.json 的手写 semantic 块`);

const dist = {};
for (const e of entries) dist[e.surface] = (dist[e.surface] || 0) + 1;
console.log(`  作用面分布 ${JSON.stringify(dist)}`);
