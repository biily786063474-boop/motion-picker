#!/usr/bin/env node
/**
 * 入库校验：一个组件够不够格进 custom/。
 *
 * 这些规则不是拍脑袋定的，每一条都对应一个真实踩过的坑
 * （详见 docs/组件入库标准.md 里每条规则后面的「为什么」）。
 *
 *   node scripts/validate-component.mjs                    校验 custom/ 下全部
 *   node scripts/validate-component.mjs custom/Backgrounds/MyFx   校验单个
 *   node scripts/validate-component.mjs --json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeComponent, extractPropsSchema, parseSource } from './lib/resolve.mjs';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CUSTOM = path.join(LIB, 'custom');
const CATEGORIES = ['Backgrounds', 'Components', 'Animations', 'TextAnimations'];
const JSON_MODE = process.argv.includes('--json');

const C = {
  ok: s => `\x1b[32m${s}\x1b[0m`,
  bad: s => `\x1b[31m${s}\x1b[0m`,
  warn: s => `\x1b[33m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  b: s => `\x1b[1m${s}\x1b[0m`
};

/**
 * 库里已有的组件名 → 它的本地路径。
 * 存路径是为了区分「跟别人重名」和「自己已经被合并进索引了」——
 * 后者是正常的（index-custom 跑过一次之后必然如此），不该报错。
 */
function existingNames() {
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(LIB, 'prompts/index.json'), 'utf8'));
    return new Map(idx.components.map(c => [c.name, c.localPath]));
  } catch {
    return new Map();
  }
}

function validate(dir, taken) {
  const name = path.basename(dir);
  const issues = [];
  const err = (rule, msg, fix) => issues.push({ level: 'error', rule, msg, fix });
  const warn = (rule, msg, fix) => issues.push({ level: 'warn', rule, msg, fix });

  const category = path.basename(path.dirname(dir));
  const entry = path.join(dir, `${name}.tsx`);

  /* R1 目录结构 */
  if (!CATEGORIES.includes(category))
    err('R1', `类目 "${category}" 不在允许列表里`, `放到 custom/{${CATEGORIES.join('|')}}/ 之一`);
  if (!fs.existsSync(entry))
    return { name, category, ok: false, issues: [{ level: 'error', rule: 'R1', msg: `找不到入口文件 ${name}.tsx`, fix: '目录名要和组件文件名一致' }], props: [] };

  const source = fs.readFileSync(entry, 'utf8');

  /* R2 语法能解析 */
  if (!parseSource(source)) {
    return { name, category, ok: false, issues: [{ level: 'error', rule: 'R2', msg: '源码解析失败（语法错误？）', fix: '确认是合法的 TSX' }], props: [] };
  }

  const a = analyzeComponent(entry);

  /* R3 名字唯一（排除掉「自己已在索引里」这种正常情况） */
  const selfPath = path.relative(LIB, entry).split(path.sep).join('/');
  if (taken.has(name) && taken.get(name) !== selfPath)
    err('R3', `组件名 ${name} 跟库里已有的重名（${taken.get(name)}）`, '换一个名字，索引和取用都按名字寻址');

  /* R4 默认导出 */
  if (!a.hasDefaultExport)
    warn('R4', '没有 default export', '加 export default，否则取用方要用具名导入（库里只有 GridScan 是这样，是个例外不是惯例）');

  /* R5 参数表能推出来（选型台的面板靠它） */
  const props = extractPropsSchema(source) || [];
  if (!props.length)
    warn('R5', '推不出参数表', '给 props 写一个 TS interface（形如 XxxProps），选型台才能生成参数面板');

  /* R6 能无参渲染 —— 选型台是直接 <Comp /> 挂上去的 */
  const required = (a.props?.required || []).filter(p => p !== 'children');
  if (required.length)
    warn('R6', `有 ${required.length} 个必填 prop：${required.join(', ')}`, '给默认值，或在 meta.json 的 previewDefaults 里提供，否则选型台里直接白屏');

  /* R7 不引外部网络资源 —— 这个库的立身之本是离线可用 */
  if (a.remoteUrls.length)
    err('R7', `源码里有 ${a.remoteUrls.length} 处外链：${a.remoteUrls.slice(0, 2).join(' ')}`, '换成内联 data URI 或放进 public/ 走本地路径');

  /* R8 同目录资源要真的在 */
  for (const rel of a.assets) {
    if (!fs.existsSync(path.resolve(dir, rel))) err('R8', `引用了不存在的资源 ${rel}`, '把资源文件放进组件目录');
  }

  /* R9 public 资源要真的在 */
  for (const rel of a.publicAssets) {
    if (!fs.existsSync(path.join(LIB, 'public', rel.replace(/^\//, ''))))
      err('R9', `引用了不存在的 public 资源 ${rel}`, `放进 ${path.join('public', rel.replace(/^\//, ''))}`);
  }

  /* R10 依赖要在 package.json 里声明过（否则选型台预览会挂） */
  const pkg = JSON.parse(fs.readFileSync(path.join(LIB, 'package.json'), 'utf8'));
  const known = new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }));
  const unknown = a.deps.filter(d => !known.has(d));
  if (unknown.length)
    warn('R10', `依赖 ${unknown.join(' ')} 不在本库 package.json 里`, `npm i ${unknown.join(' ')}，否则选型台预览它会失败`);

  /* R11 meta.json 格式 */
  const metaFile = path.join(dir, 'meta.json');
  let meta = null;
  if (fs.existsSync(metaFile)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      if (meta.category && !CATEGORIES.includes(meta.category)) err('R11', `meta.json 里的 category 非法`, `用 ${CATEGORIES.join(' / ')}`);
      if (!meta.description) warn('R11', 'meta.json 缺 description', '组件名大多没有语义（Silk / Prism），一句话描述能让人和 AI 都找得到它');
      if (!meta.license || !meta.source) warn('R11', 'meta.json 缺 license 或 source', '写清楚代码来源，避免日后说不清');
    } catch (e) {
      err('R11', `meta.json 不是合法 JSON：${e.message.slice(0, 40)}`, '修一下');
    }
  } else {
    warn('R11', '没有 meta.json', '建议加上，至少写 description / source / license');
  }

  /* R12 体积 —— 单文件组件是这个库的形态前提 */
  const kb = Buffer.byteLength(source) / 1024;
  if (kb > 80) warn('R12', `源码 ${kb.toFixed(0)}KB，偏大`, '考虑是不是该拆，或者确认它确实是单文件组件');

  return {
    name,
    category,
    ok: !issues.some(i => i.level === 'error'),
    issues,
    props: props.length,
    deps: a.deps,
    assets: a.assets,
    usesTailwind: a.usesTailwind,
    meta
  };
}

/* ---------- 主流程 ---------- */
const arg = process.argv.slice(2).find(a => !a.startsWith('--'));
let targets = [];

if (arg) {
  targets = [path.resolve(arg)];
} else if (fs.existsSync(CUSTOM)) {
  for (const cat of fs.readdirSync(CUSTOM)) {
    const catDir = path.join(CUSTOM, cat);
    if (!fs.statSync(catDir).isDirectory()) continue;
    for (const d of fs.readdirSync(catDir)) {
      const dir = path.join(catDir, d);
      if (fs.statSync(dir).isDirectory()) targets.push(dir);
    }
  }
}

if (!targets.length) {
  if (JSON_MODE) process.stdout.write(JSON.stringify({ total: 0, results: [] }, null, 2) + '\n');
  else
    console.log(`
custom/ 下还没有组件。

放一个进去试试：
  custom/<类目>/<组件名>/<组件名>.tsx
  custom/<类目>/<组件名>/meta.json     （可选）

类目：${CATEGORIES.join(' / ')}
标准：docs/组件入库标准.md
`);
  process.exit(0);
}

const taken = existingNames();
const results = targets.map(d => validate(d, taken));

if (JSON_MODE) {
  process.stdout.write(JSON.stringify({ total: results.length, ok: results.every(r => r.ok), results }, null, 2) + '\n');
} else {
  console.log('');
  for (const r of results) {
    const mark = r.ok ? C.ok('✓') : C.bad('✗');
    console.log(`${mark} ${C.b(r.name)} ${C.dim(`${r.category} · ${r.props} 个参数 · ${r.deps?.length ? r.deps.join(' ') : '无依赖'}`)}`);
    for (const i of r.issues) {
      const tag = i.level === 'error' ? C.bad(`  ✗ ${i.rule}`) : C.warn(`  ⚠ ${i.rule}`);
      console.log(`${tag} ${i.msg}`);
      if (i.fix) console.log(C.dim(`       → ${i.fix}`));
    }
    console.log('');
  }
  const bad = results.filter(r => !r.ok).length;
  console.log(bad ? C.bad(`${bad}/${results.length} 个不合格\n`) : C.ok(`${results.length} 个全部合格\n`));
}

process.exit(results.every(r => r.ok) ? 0 : 1);
