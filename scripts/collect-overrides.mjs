#!/usr/bin/env node
/**
 * 把 workflow 各 agent 的产出汇总成 playground/preview-overrides.json。
 * 直接读 journal.jsonl，不依赖 workflow 的最终返回值（那个可能被截断）。
 *
 * 用法：node scripts/collect-overrides.mjs <workflow 目录>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error('用法：node scripts/collect-overrides.mjs <workflow 目录> [更多目录…]');
  process.exit(1);
}

const analyzed = new Map(); // name -> 配置
const verdicts = []; // 复核结果
const cannotSupport = []; // 预览环境满足不了的

// 后面的目录覆盖前面的（新一轮诊断优先）
for (const dir of dirs) {
  const lines = fs
    .readFileSync(path.join(dir, 'journal.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));

  for (const entry of lines) {
    const r = entry.result;
    if (!r || typeof r !== 'object') continue;

    // 第一轮 workflow 的形状：{components: [...]}
    if (Array.isArray(r.components)) {
      for (const c of r.components) if (c?.name) analyzed.set(c.name, c);
      continue;
    }
    // 第三轮 workflow 的形状：{name, childrenKind, extraProps} —— 判断预览内容该长什么样
    if (r.name && r.childrenKind && !r.fixKind) {
      const prev = analyzed.get(r.name) || {};
      analyzed.set(r.name, {
        name: r.name,
        verdict: 'needs-data',
        previewProps: { ...(prev.previewProps || {}), ...(r.extraProps || {}) },
        childrenKind: r.childrenKind,
        frameHeight: prev.frameHeight,
        note: r.reason || prev.note || ''
      });
      continue;
    }
    // 第二轮诊断 workflow 的形状：单个组件 + fixKind
    if (r.name && r.fixKind) {
      if (r.fixKind === 'cannot-support') {
        cannotSupport.push({ name: r.name, reason: r.unsupportedReason || r.rootCause });
        analyzed.delete(r.name);
        continue;
      }
      if (r.fixKind === 'already-fine') {
        // 明确判定正常的，把之前可能存在的配置保留（它可能正是让它正常的原因），只是不新增
        continue;
      }
      const prev = analyzed.get(r.name) || {};
      analyzed.set(r.name, {
        name: r.name,
        verdict: 'needs-data',
        previewProps: { ...(prev.previewProps || {}), ...(r.previewProps || {}) },
        childrenKind: r.childrenKind || prev.childrenKind,
        frameHeight: r.frameHeight ?? prev.frameHeight,
        note: r.rootCause || prev.note || ''
      });
      continue;
    }
    if (typeof r.ok === 'boolean' && r.name) verdicts.push(r);
  }
}

let corrected = 0;
for (const v of verdicts) {
  if (v.ok || !v.corrected) continue;
  const t = analyzed.get(v.name);
  if (!t) continue;
  t.previewProps = v.corrected;
  t.note = `${t.note || ''} [复核修正：${v.reason || ''}]`.trim();
  corrected++;
}

const out = {};
const skipped = [];
for (const [name, c] of analyzed) {
  const hasProps = c.previewProps && Object.keys(c.previewProps).length > 0;
  const hasChildren = c.childrenKind && c.childrenKind !== 'none';
  const hasFrame = typeof c.frameHeight === 'number';
  if (c.verdict === 'fine-as-is' && !hasProps && !hasChildren && !hasFrame) {
    skipped.push(name);
    continue;
  }
  out[name] = {
    ...(hasProps ? { previewProps: c.previewProps } : {}),
    ...(hasChildren ? { childrenKind: c.childrenKind } : {}),
    ...(hasFrame ? { frameHeight: c.frameHeight } : {}),
    note: c.note || ''
  };
}

// 外部网络资源会让离线场景直接空白，这里硬拦一道
const remote = [];
for (const [name, cfg] of Object.entries(out)) {
  const json = JSON.stringify(cfg.previewProps || {});
  const hits = json.match(/https?:\/\/[^"']+/g) || [];
  // data:image/svg+xml 里的 xmlns 命名空间不算外部请求
  const real = hits.filter(h => !/www\.w3\.org/.test(h));
  if (real.length) remote.push(`${name}: ${real.slice(0, 2).join(', ')}`);
}

const sorted = Object.fromEntries(Object.keys(out).sort().map(k => [k, out[k]]));
fs.writeFileSync(path.join(ROOT, 'playground/preview-overrides.json'), JSON.stringify(sorted, null, 2) + '\n');

if (cannotSupport.length) {
  console.log(`\n预览环境满足不了的 ${cannotSupport.length} 个：`);
  for (const c of cannotSupport) console.log(`  ${c.name}：${(c.reason || '').slice(0, 90)}`);
}
console.log(`\n分析过 ${analyzed.size} 个组件`);
console.log(`  写入配置 ${Object.keys(out).length} 个`);
console.log(`  判定无需配置 ${skipped.length} 个：${skipped.join(', ') || '无'}`);
console.log(`  复核修正 ${corrected} 个`);
if (remote.length) {
  console.error(`\n⚠ 引用了外部网络资源（离线会失效）${remote.length} 个：`);
  for (const r of remote) console.error('  ' + r);
  process.exitCode = 1;
}
