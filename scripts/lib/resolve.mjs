/**
 * 组件源码的静态解析：它依赖哪些包、带哪些资源、埋了哪些外链。
 *
 * 这些逻辑原先散在 build-prompts.mjs 和 check-deps.mjs 两处各写一遍，
 * 现在集中到这里，取用 CLI 也用同一份 —— 三个地方算出来的东西必须一致，
 * 否则「选型台显示的依赖」和「CLI 让你装的依赖」会对不上。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

/** 解析成 AST；语法有问题时返回 null 而不是抛，调用方自己决定怎么处理 */
export function parseSource(source) {
  try {
    return parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  } catch {
    return null;
  }
}

/** 遍历 AST 的所有节点 */
function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) child.forEach(c => walk(c, visit));
    else if (child && typeof child.type === 'string') walk(child, visit);
  }
}

/**
 * 源码里所有的模块说明符（含静态 import、动态 import()、require()）。
 * 只看静态 import 会漏掉真实依赖。
 */
export function importSpecifiers(source) {
  const ast = parseSource(source);
  if (!ast) return [];
  const out = new Set();
  walk(ast.program, node => {
    if (node.type === 'ImportDeclaration') out.add(node.source.value);
    if (node.type === 'ImportExpression' && node.source?.type === 'StringLiteral') out.add(node.source.value);
    if (node.type === 'CallExpression' && node.callee?.name === 'require' && node.arguments[0]?.type === 'StringLiteral')
      out.add(node.arguments[0].value);
  });
  return [...out];
}

/** 说明符 → 包名（@scope/pkg/sub → @scope/pkg） */
export const packageOf = spec => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

/**
 * 源码真正依赖的第三方包。
 *
 * 这是唯一可信的依赖来源 —— 上游文档里的 `dependencies` 字段实测 139 个里有 11 个对不上：
 * Silk 连这行都没有（实际要 @react-three/fiber + three）、PillNav 漏 react-router-dom、
 * GradualBlur 反过来多报了 mathjs。
 */
export function realDependencies(source, { excludeReact = true } = {}) {
  const builtin = new Set(excludeReact ? ['react', 'react-dom'] : []);
  const pkgs = new Set();
  for (const spec of importSpecifiers(source)) {
    if (spec.startsWith('.') || spec.startsWith('/')) continue;
    const pkg = packageOf(spec);
    if (!builtin.has(pkg)) pkgs.add(pkg);
  }
  return [...pkgs].sort();
}

/** 源码 import 的同目录静态资源（Lanyard 的 card.glb / lanyard.png），不含代码文件 */
export function importedAssets(source) {
  return importSpecifiers(source).filter(
    s => s.startsWith('.') && path.extname(s) && !/\.(tsx?|jsx?|css)$/.test(s)
  );
}

/** 源码里以绝对路径引用的 public 资源（FluidGlass 的 /assets/3d/lens.glb 之类） */
export function publicAssets(source) {
  const hits = source.match(/['"`](\/[a-zA-Z0-9_./-]+\.(?:glb|gltf|hdr|png|jpe?g|webp|mp4|webm|svg))['"`]/g) || [];
  return [...new Set(hits.map(h => h.slice(1, -1)))];
}

/**
 * 源码里硬编码的远端 URL。
 *
 * 这些在开发机上联网时一切正常，打包进 Electron 交给离线用户才炸 ——
 * picsum / unsplash 的图、Google Fonts、jsdelivr 上的 face-api 权重。
 */
export function remoteUrls(source) {
  const hits = source.match(/['"`](https?:\/\/[^'"`\s]+)['"`]/g) || [];
  return [
    ...new Set(
      hits
        .map(h => h.slice(1, -1))
        .filter(u => !/w3\.org|github\.com\/|codepen\.io/.test(u)) // XML 命名空间和注释里的链接
    )
  ];
}

/**
 * 组件函数真正解构的 prop 名单，以及 rest 参数的去向。
 *
 * 文档（propData）会跟实现对不上：AnimatedContent 的文档写 `dissappearAfter`，
 * 源码解构的是 `disappearAfter`。照文档传进去会落进 `...props` 透传到 DOM，
 * React 直接报 "does not recognize the prop on a DOM element"。
 */
export function componentProps(source) {
  const ast = parseSource(source);
  if (!ast) return null;

  const restGoesToDOM = restName => {
    if (!restName) return false;
    let found = false;
    walk(ast.program, node => {
      if (found || node.type !== 'JSXElement') return;
      const tag = node.openingElement.name;
      if (tag.type !== 'JSXIdentifier' || !/^[a-z]/.test(tag.name)) return;
      for (const attr of node.openingElement.attributes)
        if (attr.type === 'JSXSpreadAttribute' && attr.argument?.name === restName) found = true;
    });
    return found;
  };

  const fromObjectPattern = pattern => {
    const keys = [];
    const required = [];
    let restName = null;
    for (const p of pattern.properties) {
      if (p.type === 'RestElement') {
        restName = p.argument?.name || null;
        continue;
      }
      const k = p.key?.name ?? p.key?.value;
      if (!k) continue;
      keys.push(k);
      // 解构里没有 `=` 的就是必需 prop，不传就是 undefined
      if (p.value?.type !== 'AssignmentPattern') required.push(k);
    }
    return { keys, required, hasRest: Boolean(restName), restToDOM: restName ? restGoesToDOM(restName) : false };
  };

  const typeMembers = new Map();
  for (const node of ast.program.body) {
    const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (decl?.type === 'TSInterfaceDeclaration')
      typeMembers.set(decl.id.name, decl.body.body.map(m => m.key?.name ?? m.key?.value).filter(Boolean));
    if (decl?.type === 'TSTypeAliasDeclaration' && decl.typeAnnotation?.type === 'TSTypeLiteral')
      typeMembers.set(decl.id.name, decl.typeAnnotation.members.map(m => m.key?.name ?? m.key?.value).filter(Boolean));
  }

  const fromTypedParam = param => {
    const typeName = param?.typeAnnotation?.typeAnnotation?.typeName?.name;
    const keys = typeName && typeMembers.get(typeName);
    return keys?.length ? { keys, required: [], hasRest: false, restToDOM: false } : null;
  };

  const paramsOf = node => {
    if (!node) return null;
    if (node.type === 'CallExpression') return paramsOf(node.arguments[0]); // forwardRef / memo
    if (node.type === 'TSAsExpression') return paramsOf(node.expression);
    if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(node.type)) {
      const p0 = node.params[0];
      if (p0?.type === 'ObjectPattern') return fromObjectPattern(p0);
      if (p0?.type === 'Identifier') return fromTypedParam(p0);
    }
    return null;
  };

  let exportedName = null;
  for (const node of ast.program.body) {
    if (node.type !== 'ExportDefaultDeclaration') continue;
    const direct = paramsOf(node.declaration);
    if (direct) return direct;
    if (node.declaration.type === 'Identifier') exportedName = node.declaration.name;
  }

  if (exportedName) {
    for (const node of ast.program.body) {
      if (node.type === 'FunctionDeclaration' && node.id?.name === exportedName) {
        const p = paramsOf(node);
        if (p) return p;
      }
      if (node.type === 'VariableDeclaration')
        for (const d of node.declarations) {
          if (d.id.name !== exportedName) continue;
          const p = paramsOf(d.init);
          if (p) return p;
        }
    }
  }

  for (const node of ast.program.body) {
    const direct = paramsOf(node.type === 'ExportNamedDeclaration' ? node.declaration : node);
    if (direct) return direct;
    if (node.type === 'VariableDeclaration')
      for (const d of node.declarations) {
        const p = paramsOf(d.init);
        if (p) return p;
      }
  }
  return null;
}

/**
 * 从 TS 类型声明 + 解构默认值里提取参数表（name / type / default / description）。
 *
 * 上游组件的这份数据来自站点的 propData（人工维护的文档），自有组件没有那个东西，
 * 所以直接从代码里推 —— 类型取自 interface/type，默认值取自解构，
 * 说明取自成员上方的注释。选型台的参数面板就靠这份数据生成。
 */
export function extractPropsSchema(source) {
  const ast = parseSource(source);
  if (!ast) return null;

  const lines = source.split('\n');
  /** 取成员声明上方的注释当描述 */
  const commentAbove = node => {
    const start = node.loc?.start.line;
    if (!start) return '';
    for (let i = start - 2; i >= Math.max(0, start - 4); i--) {
      const t = (lines[i] || '').trim();
      if (!t) continue;
      const m = t.match(/^\/\*\*?\s*(.*?)\s*\*?\/$/) || t.match(/^\/\/\s*(.*)$/) || t.match(/^\*\s*(.*)$/);
      if (m && m[1] && !m[1].startsWith('@')) return m[1].trim();
      if (!t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')) break;
    }
    return '';
  };

  /** 把类型节点还原成人看的字符串 */
  const typeText = ann => {
    if (!ann) return 'any';
    const t = ann.typeAnnotation || ann;
    const raw = source.slice(t.start, t.end).replace(/\s+/g, ' ').trim();
    return raw.length > 60 ? raw.slice(0, 57) + '…' : raw;
  };

  // 组件参数解构里的默认值
  const params = componentProps(source);
  const defaults = new Map();
  const walkForDefaults = node => {
    if (!node || typeof node.type !== 'string') return;
    if (
      ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(node.type) &&
      node.params[0]?.type === 'ObjectPattern'
    ) {
      for (const p of node.params[0].properties) {
        if (p.type !== 'ObjectProperty' || p.value?.type !== 'AssignmentPattern') continue;
        const key = p.key?.name ?? p.key?.value;
        if (key && !defaults.has(key)) defaults.set(key, source.slice(p.value.right.start, p.value.right.end).trim());
      }
    }
    for (const k of Object.keys(node)) {
      const c = node[k];
      if (Array.isArray(c)) c.forEach(walkForDefaults);
      else if (c && typeof c.type === 'string') walkForDefaults(c);
    }
  };
  walkForDefaults(ast.program);

  // 找 props 的类型声明：优先组件参数的类型注解，其次名字像 XxxProps 的
  const decls = new Map();
  for (const node of ast.program.body) {
    const d = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (d?.type === 'TSInterfaceDeclaration') decls.set(d.id.name, d.body.body);
    if (d?.type === 'TSTypeAliasDeclaration' && d.typeAnnotation?.type === 'TSTypeLiteral')
      decls.set(d.id.name, d.typeAnnotation.members);
  }
  let members = null;
  for (const [name, m] of decls) if (/props$/i.test(name)) members = m;
  if (!members && decls.size === 1) members = [...decls.values()][0];

  const props = [];
  if (members) {
    for (const m of members) {
      const name = m.key?.name ?? m.key?.value;
      if (!name) continue;
      props.push({
        name,
        type: typeText(m.typeAnnotation),
        default: defaults.get(name) ?? '',
        description: commentAbove(m)
      });
    }
  } else if (params?.keys?.length) {
    // 没有类型声明，至少把解构出来的 prop 名和默认值给出来
    for (const name of params.keys)
      props.push({ name, type: 'any', default: defaults.get(name) ?? '', description: '' });
  }
  return props;
}

/** 有没有 default export —— GridScan 是 139 个里唯一只有具名导出的 */
export function hasDefaultExport(source) {
  const ast = parseSource(source);
  if (!ast) return true;
  return ast.program.body.some(n => n.type === 'ExportDefaultDeclaration');
}

/** 一次把一个组件文件该知道的都算出来 */
export function analyzeComponent(file) {
  const source = fs.readFileSync(file, 'utf8');
  return {
    source,
    deps: realDependencies(source),
    assets: importedAssets(source),
    publicAssets: publicAssets(source),
    remoteUrls: remoteUrls(source),
    props: componentProps(source),
    hasDefaultExport: hasDefaultExport(source),
    usesTailwind: /className=["'`][^"'`]*\b(?:flex|grid|absolute|relative|w-|h-|p-|m-|text-|bg-|rounded|border|inset-|z-)/.test(source),
    usesGLTF: /useGLTF|GLTFLoader/.test(source)
  };
}
