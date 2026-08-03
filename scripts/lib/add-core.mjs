/**
 * 取用核心：把一个组件从本库拷进目标项目。
 *
 * 这一层是纯逻辑 —— 不 console.log、不 process.exit、不读 argv。
 * 所有诊断信息都是返回值的一部分，这样它既能被命令行调用，也能被
 * Electron 主进程、eas-term、MCP server 之类直接 import。
 *
 *   import { addComponent } from './lib/add-core.mjs';
 *   const r = await addComponent({ name: 'Silk', to: '/abs/path', dryRun: true });
 *
 * 写入是原子的：先算完整计划并校验全部前置条件，全通过才开始写，
 * 中途失败回滚已写的文件。dryRun 走完全部计算和校验，只是不落盘。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const LIB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));

let _index = null;
function index() {
  if (!_index) _index = readJSON(path.join(LIB_ROOT, 'prompts/index.json'));
  return _index;
}

let _meta = null;
function meta() {
  if (!_meta) {
    try {
      _meta = readJSON(path.join(LIB_ROOT, 'prompts/.meta.json'));
    } catch {
      _meta = {};
    }
  }
  return _meta;
}

/** 库里有哪些组件，可按关键字/类目/依赖筛 */
export function listComponents({ query = '', category = null, noDeps = false } = {}) {
  const q = query.trim().toLowerCase();
  return index().components.filter(c => {
    if (category && c.category !== category) return false;
    if (noDeps && c.realDeps.length) return false;
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q) ||
      c.realDeps.some(d => d.toLowerCase().includes(q))
    );
  });
}

export function getComponent(name) {
  return index().components.find(c => c.name.toLowerCase() === String(name).toLowerCase()) || null;
}

/** 从目标目录往上找宿主项目根（有 package.json 的那一层） */
export function findProjectRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const semverMajor = v => {
  const m = String(v || '').match(/(\d+)\./);
  return m ? Number(m[1]) : null;
};

/**
 * 宿主体检 —— 整个取用流程里性价比最高的部分。
 *
 * 这个库在 React 19 + Tailwind 4 + three 0.180 上验证；如果宿主是 React 18、
 * 没装 Tailwind、three 版本又不同，取用会「拷贝成功但画面塌」，
 * 而且大概率被误判成「这个组件坏了」然后开始瞎改组件。
 */
export function inspectHost(comp, projectRoot) {
  const warnings = [];
  const push = (level, code, message, detail) => warnings.push({ level, code, message, detail });

  let pkg = null;
  if (projectRoot) {
    try {
      pkg = readJSON(path.join(projectRoot, 'package.json'));
    } catch {}
  }
  const allDeps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };

  if (!pkg) {
    push('warn', 'no-package-json', '目标位置往上 8 层都没找到 package.json，跳过宿主体检', { projectRoot });
    return warnings;
  }

  // ① Tailwind：95/139 组件带 Tailwind 类，宿主没装就是静默无样式（不报错，布局全塌）
  if (comp.usesTailwind && !allDeps.tailwindcss) {
    push('error', 'missing-tailwind', `${comp.name} 用了 Tailwind 工具类，但宿主没装 tailwindcss —— 组件会挂载成功但完全没有样式，控制台不会报任何错`, {
      fix: ['给宿主接上 Tailwind', `或手工把 ${comp.name}.tsx 里的 className 改写成自己的样式方案`]
    });
  }

  // ② React 版本
  const reactMajor = semverMajor(allDeps.react);
  const R3F = ['@react-three/fiber', '@react-three/drei', '@react-three/postprocessing', '@react-three/rapier'];
  const usesR3F = comp.realDeps.filter(d => R3F.includes(d));

  if (reactMajor && reactMajor < 19 && usesR3F.length) {
    // 实测：@react-three/fiber v9 的 peer 是 react >=19 <19.3，
    // 在 React 18 宿主上 `npm i @react-three/fiber` 会被 npm 直接拒绝（ERESOLVE）。
    // 硬装进去的话 <Canvas> 渲染时抛 "Objects are not valid as a React child"，
    // 而且没有 ErrorBoundary 时会把整个 React 树带塌 —— 实测整页全黑。
    push('error', 'r3f-needs-react19', `${comp.name} 依赖 ${usesR3F.join(' / ')}，而这套包的当前大版本硬性要求 React 19；宿主是 React ${reactMajor}`, {
      detail: 'npm 会直接拒绝安装（ERESOLVE）。强行 --legacy-peer-deps 装进去，<Canvas> 渲染时会抛 "Objects are not valid as a React child" 并把整个 React 树带塌',
      fix: [
        '装 @react-three/fiber@^8 与配套的 drei@^9（v8 系列支持 React 18）',
        '或者把宿主升到 React 19',
        '或者换一个不依赖 three 的组件 —— 库里有 36 个零依赖的'
      ]
    });
  } else if (reactMajor && reactMajor < 19) {
    push('warn', 'react-version', `宿主是 React ${reactMajor}，本库在 React 19 上验证`, {
      detail: '把 ref 当普通 prop 接的组件（ScrollVelocity / GradualBlur 等）在 React 18 里 ref 会被吃掉，props.ref 是 undefined —— 不报错，就是不动'
    });
  }

  // ③ 依赖版本差异
  const libPkg = readJSON(path.join(LIB_ROOT, 'package.json'));
  for (const dep of comp.realDeps) {
    const hostVer = allDeps[dep];
    if (!hostVer) continue;
    const libVer = libPkg.dependencies?.[dep];
    if (libVer && semverMajor(hostVer) === semverMajor(libVer)) {
      const hostMinor = String(hostVer).match(/\d+\.(\d+)/)?.[1];
      const libMinor = String(libVer).match(/\d+\.(\d+)/)?.[1];
      if (hostMinor !== libMinor)
        push('info', 'dep-version-drift', `${dep} 版本不同：宿主 ${hostVer} / 本库 ${libVer}`, { dep });
    } else if (libVer) {
      push('warn', 'dep-major-mismatch', `${dep} 大版本不同：宿主 ${hostVer} / 本库 ${libVer}`, { dep });
    }
  }

  // ④ 外链默认值：开发机联网时一切正常，打包进 Electron 交给离线用户才炸
  if (comp.remoteUrls?.length) {
    push('warn', 'remote-urls', `${comp.name} 的默认值里有 ${comp.remoteUrls.length} 处外链，离线环境会失败`, {
      urls: comp.remoteUrls.slice(0, 6)
    });
  }

  // ⑤ useGLTF 要带 draco 解码器
  if (comp.usesGLTF) {
    push('info', 'needs-draco', `${comp.name} 用了 useGLTF，离线时 drei 会去 gstatic 拉 Draco 解码器并卡住`, {
      fix: [`把 ${path.join(LIB_ROOT, 'public/draco')} 拷进宿主的 public/`, "入口加一行 useGLTF.setDecoderPath('/draco/')"]
    });
  }

  // ⑥ 只有具名导出
  if (comp.namedExportOnly) {
    push('info', 'named-export-only', `${comp.name} 没有 default export，要用 import { ${comp.name} } from '...'`, {});
  }

  // ⑦ 已知问题
  try {
    const known = readJSON(path.join(LIB_ROOT, 'scripts/known-issues.json'));
    const hit = known[comp.name];
    if (hit) push('warn', 'known-issue', `${comp.name} 有已知问题：${hit.summary}`, hit);
  } catch {}

  return warnings;
}

/** 文件头的出处戳。只盖在拷出去的副本上，components/ 本体保持与上游字节一致 */
function stamp(comp, sha, upstreamCommit, takenAt) {
  return `/**
 * ${comp.name} — 取自 React Bits（MIT）
 * https://github.com/DavidHDev/react-bits  ·  ${comp.url}
 * 上游 commit ${upstreamCommit || '(未知)'}  ·  取用于 ${takenAt}
 * 原始源码 sha256 ${sha}
 *
 * 这份是副本，改它不会影响本地资产库。要跟上游对账用上面的 sha256。
 */
`;
}

/**
 * 把组件拷进目标项目。
 *
 * @param {object} opts
 * @param {string} opts.name          组件名
 * @param {string} opts.to            目标目录（组件文件放这儿）
 * @param {string} [opts.publicDir]   宿主的 public 目录，不给则自动找
 * @param {string} [opts.assetPrefix] public 资源的新路径前缀，用于重写源码里的绝对路径
 * @param {boolean} [opts.dryRun]     只算不写
 * @param {boolean} [opts.force]      允许覆盖已存在的文件
 * @param {boolean} [opts.stamp]      是否盖出处戳，默认 true
 */
export async function addComponent(opts) {
  const { name, to, publicDir, assetPrefix, dryRun = false, force = false, stamp: doStamp = true } = opts || {};

  const result = {
    ok: false,
    name,
    dryRun,
    written: [],
    skipped: [],
    deps: { missing: [], satisfied: [] },
    warnings: [],
    manifest: null,
    errors: []
  };

  const comp = getComponent(name);
  if (!comp) {
    const near = listComponents({ query: String(name).slice(0, 4) })
      .slice(0, 5)
      .map(c => c.name);
    result.errors.push({ code: 'not-found', message: `库里没有组件 ${name}`, detail: { near } });
    return result;
  }
  result.name = comp.name;

  if (!to) {
    result.errors.push({ code: 'no-target', message: '必须指定目标目录（to）' });
    return result;
  }
  const targetDir = path.resolve(to);
  const projectRoot = findProjectRoot(targetDir);

  // ---- 1. 算出完整的写入计划 ----
  const plan = [];
  const srcFile = path.join(LIB_ROOT, comp.localPath);
  if (!fs.existsSync(srcFile)) {
    result.errors.push({ code: 'source-missing', message: `本库里找不到源文件 ${comp.localPath}` });
    return result;
  }

  let source = fs.readFileSync(srcFile, 'utf8');
  const sha = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);

  // public 资源：拷进宿主 public/ 并重写源码里的绝对路径
  const resolvedPublicDir = publicDir
    ? path.resolve(publicDir)
    : projectRoot
      ? path.join(projectRoot, 'public')
      : null;

  for (const rel of comp.publicAssets || []) {
    const from = path.join(LIB_ROOT, 'public', rel.replace(/^\//, ''));
    if (!fs.existsSync(from)) {
      result.warnings.push({
        level: 'warn',
        code: 'public-asset-missing',
        message: `源码引用了 ${rel}，但本库的 public/ 里没有这个文件`,
        detail: { rel }
      });
      continue;
    }
    if (!resolvedPublicDir) {
      result.warnings.push({
        level: 'warn',
        code: 'no-public-dir',
        message: `${rel} 没处放（找不到宿主的 public 目录），组件运行时会 404`,
        detail: { rel }
      });
      continue;
    }
    const newRel = assetPrefix ? path.posix.join(assetPrefix, path.posix.basename(rel)) : rel;
    plan.push({ kind: 'public-asset', from, to: path.join(resolvedPublicDir, newRel.replace(/^\//, '')) });
    // Electron 打包后走 file:// 协议，根绝对路径必挂，所以路径重写是必须的
    if (newRel !== rel) source = source.split(rel).join(newRel);
  }

  // 同目录资源（Lanyard 的 card.glb / lanyard.png）
  for (const rel of comp.assets || []) {
    const from = path.resolve(path.dirname(srcFile), rel);
    if (!fs.existsSync(from)) {
      result.errors.push({ code: 'asset-missing', message: `组件依赖的资源不存在：${rel}` });
      return result;
    }
    plan.push({ kind: 'asset', from, to: path.resolve(targetDir, rel) });
  }

  const takenAt = new Date().toISOString().slice(0, 10);
  const content = (doStamp ? stamp(comp, sha, meta().commit, takenAt) : '') + source;
  plan.unshift({ kind: 'component', to: path.join(targetDir, `${comp.name}.tsx`), content });

  // ---- 2. 校验全部前置条件（一个不过就整个不写）----
  for (const item of plan) {
    if (fs.existsSync(item.to) && !force) {
      result.errors.push({
        code: 'exists',
        message: `目标已存在：${path.relative(projectRoot || '/', item.to)}（要覆盖请加 force）`,
        detail: { path: item.to }
      });
    }
  }
  if (result.errors.length) return result;

  // ---- 3. 依赖与体检 ----
  let hostDeps = {};
  if (projectRoot) {
    try {
      const pkg = readJSON(path.join(projectRoot, 'package.json'));
      hostDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    } catch {}
  }
  for (const d of comp.realDeps) (hostDeps[d] ? result.deps.satisfied : result.deps.missing).push(d);

  result.warnings.push(...inspectHost(comp, projectRoot));

  result.manifest = {
    name: comp.name,
    category: comp.category,
    upstreamCommit: meta().commit || null,
    upstreamUrl: comp.url,
    sha256: sha,
    takenAt,
    deps: comp.realDeps,
    license: 'MIT (react-bits)'
  };

  // ---- 4. 写入（原子：失败回滚）----
  if (dryRun) {
    result.written = plan.map(p => ({ path: p.to, kind: p.kind, bytes: p.content ? Buffer.byteLength(p.content) : fs.statSync(p.from).size }));
    result.ok = true;
    return result;
  }

  const created = [];
  try {
    for (const item of plan) {
      fs.mkdirSync(path.dirname(item.to), { recursive: true });
      const existed = fs.existsSync(item.to);
      if (item.content !== undefined) fs.writeFileSync(item.to, item.content);
      else fs.copyFileSync(item.from, item.to);
      if (!existed) created.push(item.to);
      result.written.push({
        path: item.to,
        kind: item.kind,
        bytes: fs.statSync(item.to).size
      });
    }

    // 取用记录，方便日后知道这个项目里哪些代码是从库里拿的
    if (projectRoot) {
      const mf = path.join(projectRoot, '.rb-manifest.json');
      let manifest = { components: [] };
      try {
        manifest = readJSON(mf);
      } catch {}
      manifest.components = (manifest.components || []).filter(c => c.name !== comp.name);
      manifest.components.push({ ...result.manifest, to: path.relative(projectRoot, targetDir) });
      fs.writeFileSync(mf, JSON.stringify(manifest, null, 2) + '\n');
      result.written.push({ path: mf, kind: 'manifest', bytes: fs.statSync(mf).size });
    }

    result.ok = true;
  } catch (e) {
    // 回滚这次新建的文件，不动本来就存在的
    for (const f of created) {
      try {
        fs.rmSync(f, { force: true });
      } catch {}
    }
    result.written = [];
    result.errors.push({ code: 'write-failed', message: e.message, detail: { rolledBack: created.length } });
  }

  return result;
}
