#!/usr/bin/env node
/**
 * 依赖体检：把 139 个组件源码里所有形式的外部引用都挖出来，逐个验证能不能真的解析到。
 *
 * 只看 package.json 里有没有包名是不够的：
 *   - 动态 import()（构建期不一定报错）
 *   - 子路径深度引用（three/examples/jsm/... 这类，主包装了不等于子路径存在）
 *   - CSS 里的 @import
 *   - 运行时才去拉的远端资源（模型、HDR、字体）
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(path.join(ROOT, 'package.json'));

const walk = d =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

const files = walk(path.join(ROOT, 'components')).filter(f => f.endsWith('.tsx'));

const specs = new Map(); // 说明符 -> 使用它的组件
const remote = new Map(); // 远端 URL -> 使用它的组件
const add = (map, k, comp) => {
  if (!map.has(k)) map.set(k, new Set());
  map.get(k).add(comp);
};

for (const f of files) {
  const comp = path.basename(f, '.tsx');
  const src = fs.readFileSync(f, 'utf8');

  // 远端资源（运行时 fetch，装依赖也救不了）
  for (const m of src.matchAll(/['"`](https?:\/\/[^'"`\s]+)['"`]/g)) {
    const u = m[1];
    if (/w3\.org|github\.com\/|codepen\.io/.test(u)) continue; // 命名空间和注释里的链接
    add(remote, u.replace(/\?.*$/, '').slice(0, 78), comp);
  }

  let ast;
  try {
    ast = parse(src, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  } catch {
    continue;
  }

  const visit = node => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'ImportDeclaration') add(specs, node.source.value, comp);
    // 动态 import('x') 和 require('x')
    if (node.type === 'ImportExpression' && node.source?.type === 'StringLiteral') add(specs, node.source.value, comp);
    if (
      node.type === 'CallExpression' &&
      node.callee?.name === 'require' &&
      node.arguments[0]?.type === 'StringLiteral'
    )
      add(specs, node.arguments[0].value, comp);
    for (const k of Object.keys(node)) {
      const c = node[k];
      if (Array.isArray(c)) c.forEach(visit);
      else if (c && typeof c.type === 'string') visit(c);
    }
  };
  visit(ast.program);
}

const bare = [...specs.entries()].filter(([s]) => !s.startsWith('.') && !s.startsWith('/'));

const missing = [];
const ok = [];
for (const [spec, comps] of bare) {
  try {
    require_.resolve(spec);
    ok.push(spec);
  } catch (e) {
    // 有些 ESM-only 包 require.resolve 会失败，退一步看包目录在不在
    const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    const dir = path.join(ROOT, 'node_modules', pkgName);
    if (fs.existsSync(dir)) {
      const sub = spec.slice(pkgName.length + 1);
      if (!sub) ok.push(spec);
      else missing.push({ spec, comps: [...comps], why: `包在，但子路径解析失败：${e.code || e.message.slice(0, 40)}` });
    } else {
      missing.push({ spec, comps: [...comps], why: '包未安装' });
    }
  }
}

console.log(`扫描 ${files.length} 个组件，外部说明符 ${bare.length} 个，解析成功 ${ok.length} 个\n`);

if (missing.length) {
  console.log(`⚠ 解析不到的 ${missing.length} 个：`);
  for (const m of missing) console.log(`  ${m.spec}\n     ${m.why}\n     用到的组件：${m.comps.join(', ')}`);
} else {
  console.log('✓ 所有 import 都能解析到');
}

console.log(`\n运行时会去拉的远端资源 ${remote.size} 处（离线环境下必然失败）：`);
for (const [u, comps] of remote) console.log(`  ${u}\n     ${[...comps].join(', ')}`);
