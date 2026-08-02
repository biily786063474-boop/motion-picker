#!/usr/bin/env node
/**
 * ReactBits「Copy Prompt」离线复刻 · 方案 A（只出 TS-TW 一套）
 *
 * 复刻自 DavidHDev/react-bits @ main
 *   src/components/common/TabsLayout.jsx  buildPrompt() / getActiveCode()
 *   src/components/code/CodeExample.jsx   injectPropsIntoCode()（默认态下为恒等，故不复刻）
 *
 * 用法：node scripts/build-prompts.mjs [--repo .cache/react-bits-main] [--out prompts]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const getArg = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : dflt;
};
const REPO = path.resolve(ROOT, getArg('--repo', '.cache/react-bits-main'));
const OUT = path.resolve(ROOT, getArg('--out', 'prompts'));
const COMPONENTS_OUT = path.resolve(ROOT, getArg('--components-out', 'components'));
const PUBLIC_OUT = path.resolve(ROOT, getArg('--public-out', 'public'));
const SRC = path.join(REPO, 'src');

const LANG = 'TS';
const STYLE = 'TW';

// 与 vite.config.js resolve.alias 保持一致
const ALIASES = {
  '@content': path.join(SRC, 'content'),
  '@tailwind': path.join(SRC, 'tailwind'),
  '@ts-default': path.join(SRC, 'ts-default'),
  '@ts-tailwind': path.join(SRC, 'ts-tailwind'),
  '@utils': path.join(SRC, 'utils'),
  '@': SRC
};

/** 把 import 说明符解析成绝对路径（支持 vite 别名与相对路径） */
function resolveImport(spec, fromFile) {
  const clean = spec.replace(/\?raw$/, '');
  const alias = Object.keys(ALIASES).find(a => clean === a || clean.startsWith(a + '/'));
  return alias
    ? path.join(ALIASES[alias], clean.slice(alias.length))
    : path.resolve(path.dirname(fromFile), clean);
}

const parseFile = file =>
  parse(fs.readFileSync(file, 'utf8'), {
    sourceType: 'module',
    plugins: ['jsx', 'typescript']
  });

/* ---------- 字面量求值（只允许纯字面量，遇到不认识的结构直接抛错） ---------- */
function evalNode(node, file) {
  switch (node.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return node.value;
    case 'NullLiteral':
      return null;
    case 'TemplateLiteral':
      if (node.expressions.length > 0) throw new Error(`模板字符串含插值，无法静态求值：${file}`);
      return node.quasis.map(q => q.value.cooked).join('');
    case 'UnaryExpression':
      if (node.operator === '-') return -evalNode(node.argument, file);
      if (node.operator === '+') return +evalNode(node.argument, file);
      throw new Error(`不支持的一元运算符 ${node.operator}：${file}`);
    case 'ArrayExpression':
      return node.elements.map(el => (el === null ? null : evalNode(el, file)));
    case 'ObjectExpression': {
      const obj = {};
      for (const prop of node.properties) {
        if (prop.type !== 'ObjectProperty') throw new Error(`对象含非普通属性：${file}`);
        const key = prop.key.type === 'Identifier' ? prop.key.name : evalNode(prop.key, file);
        obj[key] = evalNode(prop.value, file);
      }
      return obj;
    }
    default:
      throw new Error(`无法静态求值的节点 ${node.type}：${file}`);
  }
}

/* ---------- STEP 3：解析 demo 文件（componentName / codeObject 标识符 / propData） ---------- */
function parseDemo(file) {
  const ast = parseFile(file);
  const imports = new Map(); // 本地名 -> 模块路径
  let propDataNode = null;
  let codeObjectIdent = null;
  let componentName = null;
  let previewDefaultsNode = null;

  const walk = node => {
    if (!node || typeof node.type !== 'string') return;

    if (node.type === 'ImportDeclaration') {
      for (const spec of node.specifiers) imports.set(spec.local.name, node.source.value);
    }

    // 站点预览区的初始参数，与 propData 里的组件默认值常常不同（如 Orb.hoverIntensity 0.2 vs 2）
    if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.id.name === 'DEFAULT_PROPS' &&
      node.init?.type === 'ObjectExpression'
    ) {
      previewDefaultsNode = node.init;
    }

    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.id.name === 'propData') {
      let init = node.init;
      // useMemo(() => [...], []) 形态
      if (
        init &&
        init.type === 'CallExpression' &&
        init.callee.type === 'Identifier' &&
        init.callee.name === 'useMemo'
      ) {
        const fn = init.arguments[0];
        init = fn.body.type === 'BlockStatement'
          ? (fn.body.body.find(s => s.type === 'ReturnStatement') || {}).argument
          : fn.body;
      }
      if (!init || init.type !== 'ArrayExpression') throw new Error(`propData 不是字面量数组：${file}`);
      propDataNode = init;
    }

    if (node.type === 'JSXElement') {
      const nameNode = node.openingElement.name;
      if (nameNode.type === 'JSXIdentifier' && nameNode.name === 'CodeExample') {
        for (const attr of node.openingElement.attributes) {
          if (attr.type !== 'JSXAttribute') continue;
          if (attr.name.name === 'componentName') {
            componentName =
              attr.value.type === 'StringLiteral'
                ? attr.value.value
                : evalNode(attr.value.expression, file);
          }
          if (attr.name.name === 'codeObject') {
            const expr = attr.value.expression;
            if (expr.type !== 'Identifier') throw new Error(`codeObject 不是标识符：${file}`);
            codeObjectIdent = expr.name;
          }
        }
      }
    }

    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child.type === 'string') walk(child);
    }
  };
  walk(ast.program);

  if (!componentName) throw new Error(`未找到 CodeExample componentName：${file}`);
  if (!codeObjectIdent) throw new Error(`未找到 CodeExample codeObject：${file}`);
  if (!propDataNode) throw new Error(`未找到 propData：${file}`);

  const propData = evalNode(propDataNode, file);
  if (!Array.isArray(propData) || propData.length === 0) throw new Error(`propData 为空：${file}`);

  const codeModule = imports.get(codeObjectIdent);
  if (!codeModule) throw new Error(`codeObject ${codeObjectIdent} 无对应 import：${file}`);

  // 预览默认值容错：函数 / JSX 之类求不出来的键直接跳过，不影响主流程
  const previewDefaults = {};
  const skippedPreviewDefaults = [];
  if (previewDefaultsNode) {
    for (const prop of previewDefaultsNode.properties) {
      if (prop.type !== 'ObjectProperty') continue;
      const key = prop.key.type === 'Identifier' ? prop.key.name : String(prop.key.value);
      try {
        previewDefaults[key] = evalNode(prop.value, file);
      } catch {
        skippedPreviewDefaults.push(key);
      }
    }
  }

  return { componentName, codeObjectIdent, codeModule, propData, previewDefaults, skippedPreviewDefaults };
}

/* ---------- STEP 2：解析 codeObject 常量文件 ---------- */
function parseCodeObject(file, ident) {
  const ast = parseFile(file);
  const rawImports = new Map(); // 本地名 -> 解析后的绝对路径
  let objNode = null;

  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration') {
      const abs = resolveImport(node.source.value, file);
      for (const spec of node.specifiers) rawImports.set(spec.local.name, abs);
    }
    if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'VariableDeclaration') {
      for (const d of node.declaration.declarations) {
        if (d.id.type === 'Identifier' && d.id.name === ident) objNode = d.init;
      }
    }
  }
  if (!objNode || objNode.type !== 'ObjectExpression') throw new Error(`未找到 export const ${ident}：${file}`);

  const codeObject = {};
  for (const prop of objNode.properties) {
    if (prop.type !== 'ObjectProperty') throw new Error(`codeObject 含非普通属性：${file}`);
    const key = prop.key.type === 'Identifier' ? prop.key.name : evalNode(prop.key, file);
    if (prop.value.type === 'Identifier' && rawImports.has(prop.value.name)) {
      const src = rawImports.get(prop.value.name);
      if (!fs.existsSync(src)) throw new Error(`?raw 源文件缺失 ${src}（来自 ${file}）`);
      codeObject[key] = fs.readFileSync(src, 'utf8');
      codeObject['__src_' + key] = path.relative(REPO, src);
    } else {
      codeObject[key] = evalNode(prop.value, file);
    }
  }
  return codeObject;
}

/** 组件源码里以绝对路径引用的 public 资源（FluidGlass 的 /assets/3d/lens.glb 之类） */
function publicAssets(source) {
  const hits = source.match(/['"`](\/[a-zA-Z0-9_./-]+\.(?:glb|gltf|hdr|png|jpe?g|webp|mp4|webm|svg))['"`]/g) || [];
  return [...new Set(hits.map(h => h.slice(1, -1)))];
}

/** 组件源码里 import 的同目录静态资源（.glb / .png 之类，不含代码文件） */
function importedAssets(source) {
  let ast;
  try {
    ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  } catch {
    return [];
  }
  return ast.program.body
    .filter(n => n.type === 'ImportDeclaration')
    .map(n => n.source.value)
    .filter(s => s.startsWith('.') && path.extname(s) && !/\.(tsx?|jsx?|css)$/.test(s));
}

/* ---------- 从组件源码解析「真正接收的 prop」 ----------
 * propData 是给人看的文档，会跟实现对不上：AnimatedContent 的文档写 `dissappearAfter`，
 * 源码解构的是 `disappearAfter`（文档多打一个 s）。照文档传进去会落进 `...props`
 * 透传到 DOM，React 直接报 "does not recognize the prop on a DOM element"。
 * 所以以源码的解构参数为准。
 */
function extractActualProps(source, label) {
  let ast;
  try {
    ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  } catch {
    return null;
  }

  /** rest 参数是 spread 到 DOM 元素（透传，多余的 prop 会让 React 报错），
   *  还是转发给内部函数（Ballpit 那样传给 createBallpit，多余的 prop 反而是有效配置）？ */
  const restGoesToDOM = restName => {
    if (!restName) return false;
    let found = false;
    const walk = node => {
      if (found || !node || typeof node.type !== 'string') return;
      if (node.type === 'JSXElement') {
        const tag = node.openingElement.name;
        const isDomTag = tag.type === 'JSXIdentifier' && /^[a-z]/.test(tag.name);
        if (isDomTag) {
          for (const attr of node.openingElement.attributes) {
            if (attr.type === 'JSXSpreadAttribute' && attr.argument?.name === restName) {
              found = true;
              return;
            }
          }
        }
      }
      for (const k of Object.keys(node)) {
        const c = node[k];
        if (Array.isArray(c)) c.forEach(walk);
        else if (c && typeof c.type === 'string') walk(c);
      }
    };
    walk(ast.program);
    return found;
  };

  const fromObjectPattern = pattern => {
    const keys = [];
    let restName = null;
    for (const p of pattern.properties) {
      if (p.type === 'RestElement') {
        restName = p.argument?.name || null;
        continue;
      }
      const k = p.key?.name ?? p.key?.value;
      if (k) keys.push(k);
    }
    return { keys, hasRest: Boolean(restName), restToDOM: restName ? restGoesToDOM(restName) : false };
  };

  /** `function Aurora(props: AuroraProps)` 这种不解构的，从类型声明里取成员名 */
  const typeMembers = new Map();
  for (const node of ast.program.body) {
    const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (decl?.type === 'TSInterfaceDeclaration')
      typeMembers.set(
        decl.id.name,
        decl.body.body.map(m => m.key?.name ?? m.key?.value).filter(Boolean)
      );
    if (decl?.type === 'TSTypeAliasDeclaration' && decl.typeAnnotation?.type === 'TSTypeLiteral')
      typeMembers.set(
        decl.id.name,
        decl.typeAnnotation.members.map(m => m.key?.name ?? m.key?.value).filter(Boolean)
      );
  }

  const fromTypedParam = param => {
    const typeName = param?.typeAnnotation?.typeAnnotation?.typeName?.name;
    const keys = typeName && typeMembers.get(typeName);
    return keys?.length ? { keys, hasRest: false, restToDOM: false } : null;
  };

  const paramsOf = node => {
    if (!node) return null;
    // React.forwardRef((props, ref) => …) / memo(fn)
    if (node.type === 'CallExpression') return paramsOf(node.arguments[0]);
    if (node.type === 'TSAsExpression') return paramsOf(node.expression);
    if (
      node.type === 'ArrowFunctionExpression' ||
      node.type === 'FunctionExpression' ||
      node.type === 'FunctionDeclaration'
    ) {
      const p0 = node.params[0];
      if (p0?.type === 'ObjectPattern') return fromObjectPattern(p0);
      if (p0?.type === 'Identifier') return fromTypedParam(p0);
    }
    return null;
  };

  // 先顺着 export default 找组件本体
  let exportedName = null;
  for (const node of ast.program.body) {
    if (node.type !== 'ExportDefaultDeclaration') continue;
    const d = node.declaration;
    const direct = paramsOf(d);
    if (direct) return { ...direct, source: label };
    if (d.type === 'Identifier') exportedName = d.name;
  }

  if (exportedName) {
    for (const node of ast.program.body) {
      if (node.type === 'FunctionDeclaration' && node.id?.name === exportedName) {
        const p = paramsOf(node);
        if (p) return { ...p, source: label };
      }
      if (node.type === 'VariableDeclaration') {
        for (const d of node.declarations) {
          if (d.id.name !== exportedName) continue;
          const p = paramsOf(d.init);
          if (p) return { ...p, source: label };
        }
      }
    }
  }

  // 退一步：文件里第一个顶层带对象解构的函数，通常就是组件
  for (const node of ast.program.body) {
    const direct = paramsOf(node.type === 'ExportNamedDeclaration' ? node.declaration : node);
    if (direct) return { ...direct, source: label };
    if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) {
        const p = paramsOf(d.init);
        if (p) return { ...p, source: label };
      }
    }
  }
  return null;
}

/* ---------- STEP 4：照抄 TabsLayout.jsx:50-118 ---------- */
function getActiveCode(codeObject, lang, style) {
  if (!codeObject) return { source: '', label: '', css: '' };

  if (lang === 'TS' && style === 'TW' && codeObject.tsTailwind)
    return { source: codeObject.tsTailwind, label: 'TypeScript + Tailwind', css: '' };
  if (lang === 'TS' && codeObject.tsCode)
    return { source: codeObject.tsCode, label: 'TypeScript + CSS', css: codeObject.css || '' };
  if (style === 'TW' && codeObject.tailwind)
    return { source: codeObject.tailwind, label: 'JavaScript + Tailwind', css: '' };

  return { source: codeObject.code || '', label: 'JavaScript + CSS', css: codeObject.css || '' };
}

function buildPrompt(componentName, codeObject, propData, lang, style) {
  const { source, label, css } = getActiveCode(codeObject, lang, style);
  const usage = codeObject.usage || '';
  const deps = codeObject.dependencies || '';

  let prompt = `## Integrate the <${componentName} /> component from React Bits

You are helping integrate an open-source React component into an existing application.

### Component: ${componentName}
### Variant: ${label}
${deps ? `### Dependencies: ${deps}` : ''}

---

### Usage Example
\`\`\`jsx
${usage}
\`\`\`
`;

  if (propData && propData.length > 0) {
    prompt += `
### Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
${propData.map(p => `| ${p.name} | ${p.type} | ${p.default || '—'} | ${p.description} |`).join('\n')}
`;
  }

  prompt += `
### Full Component Source
\`\`\`${lang === 'TS' ? 'tsx' : 'jsx'}
${source}
\`\`\`
`;

  if (css) {
    prompt += `
### Component CSS
\`\`\`css
${css}
\`\`\`
`;
  }

  prompt += `
### Integration Instructions
1. Install any listed dependencies.
2. Copy the component source into the appropriate directory in the project.
${css ? '3. Import the CSS file alongside the component.\n' : ''}${css ? '4' : '3'}. Import and render the component using the usage example above as a starting point.
${css ? '5' : '4'}. Adjust props as needed for the specific use case — refer to the props table for all available options.
`;

  return prompt;
}

/* ---------- 站点 URL：直接取自 src/constants/Categories.js 的侧边栏定义 ---------- */
const slugify = s => s.split(' ').join('-').toLowerCase();

function buildUrlMap() {
  const file = path.join(SRC, 'constants/Categories.js');
  const ast = parseFile(file);
  let arr = null;
  for (const node of ast.program.body) {
    if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'VariableDeclaration') {
      for (const d of node.declaration.declarations) {
        if (d.id.name === 'CATEGORIES') arr = evalNode(d.init, file);
      }
    }
  }
  if (!arr) throw new Error(`未找到 CATEGORIES：${file}`);

  const map = new Map(); // `${去空格类目}/${去空格组件名}` -> 站点 URL
  for (const cat of arr) {
    for (const sub of cat.subcategories) {
      const key = `${cat.name.split(' ').join('')}/${sub.split(' ').join('')}`;
      map.set(key, `https://reactbits.dev/${slugify(cat.name)}/${slugify(sub)}`);
    }
  }
  return map;
}
const URL_MAP = buildUrlMap();

/* ---------- 主流程 ---------- */
const categories = fs.readdirSync(path.join(SRC, 'demo')).filter(d =>
  fs.statSync(path.join(SRC, 'demo', d)).isDirectory()
);

const results = [];
const schema = [];
const failures = [];
const assetsCopied = [];
const missingPublicAssets = [];

for (const category of categories) {
  const dir = path.join(SRC, 'demo', category);
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('Demo.jsx')).sort()) {
    const demoFile = path.join(dir, f);
    try {
      const { componentName, codeObjectIdent, codeModule, propData, previewDefaults, skippedPreviewDefaults } =
        parseDemo(demoFile);
      const codeFile = resolveImport(codeModule, demoFile) + '.js';
      if (!fs.existsSync(codeFile)) throw new Error(`codeObject 文件不存在：${codeFile}`);
      const codeObject = parseCodeObject(codeFile, codeObjectIdent);

      const { source, label } = getActiveCode(codeObject, LANG, STYLE);
      if (label !== 'TypeScript + Tailwind') throw new Error(`未命中 TS-TW 变体（得到 ${label}）：${demoFile}`);
      if (!source.trim()) throw new Error(`TS-TW 源码为空：${demoFile}`);

      const prompt = buildPrompt(componentName, codeObject, propData, LANG, STYLE);
      const relOut = path.join(category, `${componentName}-TS-TW.md`);
      const outFile = path.join(OUT, relOut);
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, prompt);

      // 组件源码单独落盘：给 playground 直接 import，也是「库」本体（与上游字节一致，不加改动）
      const relSrc = path.join(category, `${componentName}.tsx`);
      const srcFile = path.join(COMPONENTS_OUT, relSrc);
      fs.mkdirSync(path.dirname(srcFile), { recursive: true });
      fs.writeFileSync(srcFile, source);

      // 少数组件 import 了同目录的静态资源（Lanyard 的 card.glb / lanyard.png），
      // 只拷 .tsx 会让它 500。跟着源码一起搬过来。
      const upstreamDir = path.dirname(path.join(REPO, codeObject.__src_tsTailwind));
      for (const spec of importedAssets(source)) {
        const from = path.resolve(upstreamDir, spec);
        const to = path.resolve(path.dirname(srcFile), spec);
        if (!fs.existsSync(from)) throw new Error(`组件依赖的资源不存在：${from}（来自 ${relSrc}）`);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
        assetsCopied.push(path.relative(ROOT, to));
      }

      // 还有一类是按绝对路径从 public/ 取的（FluidGlass 的 /assets/3d/lens.glb），
      // 不拷的话组件会拿到 index.html 然后报 "Unexpected token '<'"
      for (const spec of publicAssets(source)) {
        const from = path.join(REPO, 'public', spec);
        if (!fs.existsSync(from)) {
          missingPublicAssets.push(`${componentName} → ${spec}`);
          continue;
        }
        const to = path.join(PUBLIC_OUT, spec);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
        assetsCopied.push(path.relative(ROOT, to));
      }

      const actual = extractActualProps(source, relSrc);
      const documented = propData.map(p => p.name);
      // 只有当 rest 会 spread 到 DOM 时，文档里多出来的 prop 才是有害的；
      // 像 Ballpit 那样把 rest 转发给 createBallpit()，多出来的反而是有效配置
      const restIsSafe = actual?.hasRest && !actual.restToDOM;
      const phantom = actual && !restIsSafe ? documented.filter(n => !actual.keys.includes(n)) : [];

      schema.push({
        name: componentName,
        category,
        usage: codeObject.usage || '',
        dependencies: codeObject.dependencies || '',
        prompt: relOut.split(path.sep).join('/'),
        source: relSrc.split(path.sep).join('/'),
        previewDefaults,
        skippedPreviewDefaults,
        actualProps: actual?.keys || null,
        acceptsRest: actual?.hasRest ?? null,
        restToDOM: actual?.restToDOM ?? null,
        phantomProps: phantom,
        props: propData
      });

      results.push({
        name: componentName,
        category,
        // 仅用于索引分类：个别上游写成 `npm i ogl`，剥掉命令词（prompt 正文仍照抄原文）
        dependencies: (codeObject.dependencies || '')
          .split(/[\s,]+/)
          .filter(Boolean)
          .filter(d => !['npm', 'i', 'install', 'add', 'yarn', 'pnpm', '-D', '--save'].includes(d)),
        url: (() => {
          const url = URL_MAP.get(`${category}/${componentName}`);
          if (!url) throw new Error(`Categories.js 中无此组件，无法确定站点 URL：${category}/${componentName}`);
          return url;
        })(),
        prompt: relOut.split(path.sep).join('/'),
        bytes: Buffer.byteLength(prompt),
        props: propData.length,
        source: codeObject.__src_tsTailwind
      });
    } catch (err) {
      failures.push({ file: path.relative(REPO, demoFile), error: err.message });
    }
  }
}

/* ---------- index.json + .meta.json ---------- */
results.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

const byDependency = {};
for (const r of results) {
  const keys = r.dependencies.length ? r.dependencies : ['(无依赖)'];
  for (const k of keys) (byDependency[k] ||= []).push(r.name);
}

fs.writeFileSync(
  path.join(OUT, 'index.json'),
  JSON.stringify(
    {
      variant: 'TS-TW',
      total: results.length,
      byCategory: results.reduce((acc, r) => ((acc[r.category] = (acc[r.category] || 0) + 1), acc), {}),
      byDependency,
      components: results
    },
    null,
    2
  ) + '\n'
);

// props.json：结构化元数据，给 playground 自动生成参数控件用（省得再解析 markdown 表格）
schema.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
fs.writeFileSync(
  path.join(OUT, 'props.json'),
  JSON.stringify(
    {
      variant: 'TS-TW',
      total: schema.length,
      note: 'props[].default 是组件默认值（来自 propData）；previewDefaults 是站点预览区初始值，两者常不同',
      components: schema
    },
    null,
    2
  ) + '\n'
);

// .commit-sha 内容形如 "<sha> <committer date>"，由 fetch-repo.sh 写入
let commit = null;
let commitDate = null;
try {
  [commit, commitDate] = fs.readFileSync(path.join(REPO, '.commit-sha'), 'utf8').trim().split(/\s+/);
} catch {}

fs.writeFileSync(
  path.join(OUT, '.meta.json'),
  JSON.stringify(
    {
      source: 'https://github.com/DavidHDev/react-bits',
      commit,
      commitDate,
      fetchedAt: fs.statSync(REPO).mtime.toISOString(),
      generatedAt: new Date().toISOString(),
      script: 'scripts/build-prompts.mjs',
      scriptVersion: 1,
      replicatedFrom: 'src/components/common/TabsLayout.jsx buildPrompt()',
      variant: 'TS-TW',
      license: 'MIT (react-bits) — 本地自用素材库，保留原始出处'
    },
    null,
    2
  ) + '\n'
);

console.log(`成功 ${results.length} / ${results.length + failures.length}`);
if (assetsCopied.length) console.log(`随源码拷贝的静态资源 ${assetsCopied.length} 个`);
if (missingPublicAssets.length) console.error(`上游 public/ 里找不到的资源 ${missingPublicAssets.length} 个：\n  ${missingPublicAssets.join('\n  ')}`);
console.log(
  `总字节 ${(results.reduce((s, r) => s + r.bytes, 0) / 1024 / 1024).toFixed(2)} MB，` +
    `平均 ${Math.round(results.reduce((s, r) => s + r.bytes, 0) / results.length / 1024)} KB`
);
if (failures.length) {
  console.error(`\n失败 ${failures.length} 个：`);
  for (const f of failures) console.error(`  ${f.file}\n    ${f.error}`);
  process.exit(1);
}
