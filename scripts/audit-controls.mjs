#!/usr/bin/env node
/**
 * 对全量 139 个组件跑一遍控件推断，看 playground/inferControl.js 的假设站不站得住。
 * 输出：控件类型分布、数值范围推断依据分布、以及需要人工过一遍的清单。
 *
 * 用法：node scripts/audit-controls.mjs [--list slider-fallback|unsupported|json|text]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferControl } from '../playground/inferControl.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'prompts/props.json'), 'utf8'));

const kinds = {};
const basis = {};
const lists = { 'slider-fallback': [], unsupported: [], json: [], text: [], select: [] };
let total = 0;

for (const comp of schema.components) {
  for (const prop of comp.props) {
    total++;
    const c = inferControl(prop, comp.previewDefaults);
    kinds[c.kind] = (kinds[c.kind] || 0) + 1;
    if (c.kind === 'slider') {
      basis[c.basis] = (basis[c.basis] || 0) + 1;
      if (c.basis === 'fallback')
        lists['slider-fallback'].push(`${comp.name}.${prop.name} = ${c.value} → [${c.min}, ${c.max}] step ${c.step}`);
    }
    if (c.kind === 'unsupported') lists.unsupported.push(`${comp.name}.${prop.name} (${prop.type}) — ${c.reason}`);
    if (c.kind === 'json') lists.json.push(`${comp.name}.${prop.name} (${prop.type})`);
    if (c.kind === 'text') lists.text.push(`${comp.name}.${prop.name}`);
    if (c.kind === 'select') lists.select.push(`${comp.name}.${prop.name} → ${JSON.stringify(c.options)}`);
  }
}

const pct = n => ((100 * n) / total).toFixed(1) + '%';
console.log(`组件 ${schema.components.length} 个，prop 共 ${total} 条\n`);
console.log('控件类型分布：');
for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(v).padStart(4)}  ${pct(v).padStart(6)}  ${k}`);

const interactive = total - (kinds.unsupported || 0);
console.log(`\n可交互调节：${interactive} / ${total} = ${pct(interactive)}`);

console.log('\n滑块范围的推断依据：');
for (const [k, v] of Object.entries(basis).sort((a, b) => b[1] - a[1])) {
  const label = { description: 'description 明写了范围（最可信）', name: '名字命中量纲表', fallback: '只能按默认值猜（可能不好用）' }[k];
  console.log(`  ${String(v).padStart(4)}  ${((100 * v) / (kinds.slider || 1)).toFixed(1).padStart(5)}%  ${label}`);
}

const which = process.argv.includes('--list') ? process.argv[process.argv.indexOf('--list') + 1] : null;
if (which && lists[which]) {
  console.log(`\n--- ${which} (${lists[which].length}) ---`);
  for (const l of lists[which]) console.log('  ' + l);
}
