#!/usr/bin/env node
/**
 * 把 custom/ 下的自有组件合并进索引，让 CLI 和选型台能看到它们。
 *
 * 为什么要单独一步：components/ 是 build-prompts.mjs 的生成物，
 * 每次 sync 会整目录替换掉（这是为了让上游删掉的组件在本地也消失）。
 * 手工往那里放东西必然被删，所以自有组件放 custom/，由这个脚本合并进索引。
 *
 * 顺序：build-prompts.mjs（生成上游镜像）→ index-custom.mjs（追加自有）
 * npm run sync 已经串好了。
 *
 *   node scripts/index-custom.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeComponent, extractPropsSchema } from './lib/resolve.mjs';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CUSTOM = path.join(LIB, 'custom');
const INDEX = path.join(LIB, 'prompts/index.json');
const PROPS = path.join(LIB, 'prompts/props.json');

if (!fs.existsSync(CUSTOM)) {
  console.log('custom/ 不存在，跳过');
  process.exit(0);
}

const dirs = [];
for (const cat of fs.readdirSync(CUSTOM)) {
  const catDir = path.join(CUSTOM, cat);
  if (!fs.statSync(catDir).isDirectory()) continue;
  for (const d of fs.readdirSync(catDir)) {
    const dir = path.join(catDir, d);
    if (fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, `${d}.tsx`))) dirs.push({ cat, name: d, dir });
  }
}

if (!dirs.length) {
  console.log('custom/ 下没有组件，跳过');
  process.exit(0);
}

const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const props = JSON.parse(fs.readFileSync(PROPS, 'utf8'));

// 先清掉上一轮追加的，保证幂等
index.components = index.components.filter(c => !c.custom);
props.components = props.components.filter(c => !c.custom);

const added = [];
for (const { cat, name, dir } of dirs) {
  if (index.components.some(c => c.name === name)) {
    console.error(`跳过 ${name}：与上游组件重名`);
    continue;
  }

  const entry = path.join(dir, `${name}.tsx`);
  const a = analyzeComponent(entry);
  const schema = extractPropsSchema(a.source) || [];

  let meta = {};
  try {
    meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  } catch {}

  const relPath = path.relative(LIB, entry).split(path.sep).join('/');

  index.components.push({
    name,
    category: meta.category || cat,
    custom: true,
    description: meta.description || '',
    dependencies: a.deps,
    url: meta.source || '',
    prompt: null, // 自有组件没有上游那份 prompt 文档
    bytes: Buffer.byteLength(a.source),
    props: schema.length,
    source: relPath,
    localPath: relPath,
    realDeps: a.deps,
    assets: a.assets,
    publicAssets: a.publicAssets,
    remoteUrls: a.remoteUrls,
    namedExportOnly: !a.hasDefaultExport,
    usesTailwind: a.usesTailwind,
    usesGLTF: a.usesGLTF,
    license: meta.license || null
  });

  props.components.push({
    name,
    category: meta.category || cat,
    custom: true,
    usage: meta.usage || `import ${name} from './${name}';\n\n<${name} />`,
    dependencies: a.deps.join(' '),
    prompt: null,
    source: relPath,
    previewDefaults: meta.previewDefaults || {},
    skippedPreviewDefaults: [],
    actualProps: a.props?.keys || null,
    acceptsRest: a.props?.hasRest ?? null,
    restToDOM: a.props?.restToDOM ?? null,
    phantomProps: [],
    props: schema
  });

  added.push(name);
}

const sortKey = c => `${c.category}/${c.name}`;
index.components.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
props.components.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
index.total = index.components.length;
props.total = props.components.length;
index.custom = added.length;

fs.writeFileSync(INDEX, JSON.stringify(index, null, 2) + '\n');
fs.writeFileSync(PROPS, JSON.stringify(props, null, 2) + '\n');

console.log(`合并了 ${added.length} 个自有组件：${added.join(', ')}`);
console.log(`索引现在共 ${index.total} 个（上游 ${index.total - added.length} + 自有 ${added.length}）`);
