#!/usr/bin/env node
/**
 * 冒烟测试：验证「陌生人 clone 下来能不能直接用」。
 *
 * 刻意**不装 npm 依赖** —— 取用组件本来就不需要，这也正是要守住的性质。
 * 本地和 CI 跑的是同一个脚本，跨平台（Windows 上也要过）。
 *
 *   node scripts/ci-smoke.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-smoke-'));
const HOST = path.join(TMP, 'host');

let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try {
    const detail = fn();
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL ${name}\n         ${e.message.split('\n')[0].slice(0, 160)}`);
    fail++;
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/** 用当前 node 跑库里的脚本，返回 stdout */
const run = (script, args = [], opts = {}) =>
  execFileSync(process.execPath, [path.join(LIB, script), ...args], {
    encoding: 'utf8',
    cwd: opts.cwd || LIB,
    env: { ...process.env, ...opts.env },
    stdio: ['ignore', 'pipe', opts.stderr === 'pipe' ? 'pipe' : 'ignore']
  });

console.log(`\nNode ${process.version} · ${process.platform}/${process.arch}`);
console.log(`库：${LIB}`);
console.log(`临时目录：${TMP}\n`);

fs.mkdirSync(path.join(HOST, 'src'), { recursive: true });
fs.writeFileSync(
  path.join(HOST, 'package.json'),
  JSON.stringify({ name: 'smoke-host', dependencies: { react: '^19.0.0', tailwindcss: '^4.0.0' } }, null, 2)
);

console.log('取用路径（不装任何依赖）');

check('doctor 核心层通过', () => {
  const out = run('scripts/doctor.mjs', ['--json']);
  const r = JSON.parse(out);
  const coreFailed = r.checks.filter(c => c.layer === 'core' && !c.ok);
  assert(coreFailed.length === 0, `核心层有 ${coreFailed.length} 项没过：${coreFailed.map(c => c.name).join(', ')}`);
  return `${r.checks.filter(c => c.ok).length}/${r.checks.length} 项就绪`;
});

check('列出全部组件', () => {
  const r = JSON.parse(run('scripts/add.mjs', ['--list', '--json']));
  assert(r.total >= 130, `只列出 ${r.total} 个，太少`);
  assert(r.components.every(c => c.name && c.localPath && Array.isArray(c.realDeps)), '组件记录字段不全');
  return `${r.total} 个`;
});

check('零依赖组件筛选', () => {
  const r = JSON.parse(run('scripts/add.mjs', ['--list', '--no-deps', '--json']));
  assert(r.total > 0, '一个零依赖组件都没有');
  assert(r.components.every(c => c.realDeps.length === 0), '筛出来的组件仍带依赖');
  return `${r.total} 个`;
});

check('--json 的 stdout 干净（管道安全）', () => {
  const out = run('scripts/add.mjs', ['--list', '--json']);
  JSON.parse(out); // 混入任何人类可读输出这里就炸
  assert(out.length > 50000, `输出只有 ${out.length} 字节，可能被截断`);
  return `${Math.round(out.length / 1024)}KB 完整`;
});

check('dry-run 不产生任何文件', () => {
  const before = fs.readdirSync(path.join(HOST, 'src')).length;
  run('scripts/add.mjs', ['SpotlightCard', '--to', path.join(HOST, 'src', 'fx'), '--dry-run']);
  const after = fs.existsSync(path.join(HOST, 'src', 'fx')) ? fs.readdirSync(path.join(HOST, 'src', 'fx')).length : 0;
  assert(after === 0, `dry-run 之后多了 ${after} 个文件`);
  assert(fs.readdirSync(path.join(HOST, 'src')).length === before, 'dry-run 动了目录结构');
  return '零副作用';
});

check('取用零依赖组件', () => {
  run('scripts/add.mjs', ['SpotlightCard', '--to', path.join(HOST, 'src', 'fx')]);
  const f = path.join(HOST, 'src', 'fx', 'SpotlightCard.tsx');
  assert(fs.existsSync(f), '组件文件没生成');
  const src = fs.readFileSync(f, 'utf8');
  assert(src.includes('React Bits'), '文件头缺出处戳');
  assert(src.includes('sha256'), '出处戳里缺 sha256');
  assert(fs.existsSync(path.join(HOST, '.rb-manifest.json')), '没写取用记录');
  return `${Math.round(fs.statSync(f).size / 1024)}KB`;
});

check('取用带同目录资源的组件', () => {
  run('scripts/add.mjs', ['Lanyard', '--to', path.join(HOST, 'src', 'fx')]);
  for (const asset of ['Lanyard.tsx', 'card.glb', 'lanyard.png'])
    assert(fs.existsSync(path.join(HOST, 'src', 'fx', asset)), `${asset} 没跟着走`);
  return '模型和贴图都跟着走了';
});

check('取用带 public 资源的组件并重写路径', () => {
  const out = run('scripts/add.mjs', [
    'FluidGlass',
    '--to',
    path.join(HOST, 'src', 'fx'),
    '--asset-prefix',
    '/rb',
    '--json'
  ]);
  const r = JSON.parse(out);
  assert(r.ok, '取用失败');
  const src = fs.readFileSync(path.join(HOST, 'src', 'fx', 'FluidGlass.tsx'), 'utf8');
  assert(src.includes('/rb/'), '源码里的资源路径没被重写');
  assert(!src.includes('/assets/3d/'), '还残留着原始路径');
  const copied = r.written.filter(w => w.kind === 'public-asset');
  assert(copied.length > 0, 'public 资源没拷过去');
  return `${copied.length} 个 public 资源`;
});

check('重复取用会被拦住', () => {
  let blocked = false;
  try {
    run('scripts/add.mjs', ['SpotlightCard', '--to', path.join(HOST, 'src', 'fx')]);
  } catch {
    blocked = true;
  }
  assert(blocked, '覆盖已存在的文件时没有报错');
  return '需要 --force';
});

check('宿主体检能识别缺失依赖', () => {
  const r = JSON.parse(
    run('scripts/add.mjs', ['Silk', '--to', path.join(HOST, 'src', 'fx2'), '--dry-run', '--json'])
  );
  assert(r.deps.missing.includes('@react-three/fiber'), '没识别出缺失的 @react-three/fiber');
  return `缺 ${r.deps.missing.join(' ')}`;
});

check('索引里的组件文件都真实存在', () => {
  const idx = JSON.parse(fs.readFileSync(path.join(LIB, 'prompts/index.json'), 'utf8'));
  const missing = idx.components.filter(c => !fs.existsSync(path.join(LIB, c.localPath)));
  assert(missing.length === 0, `${missing.length} 个索引项找不到文件`);
  return `${idx.components.length}/${idx.components.length}`;
});

check('语义检索零依赖可用', () => {
  // --find 跟 --list 一样属于「clone 下来就能跑」的路径：semantic.json 是预计算好的，
  // search.mjs 是纯 JS。这条守的是别往这条路上引第三方依赖。
  const r = JSON.parse(run('scripts/add.mjs', ['--find', '暗色流动的背景', '--json']));
  assert(r.results.length > 0, '「暗色流动的背景」一个都没匹配到');
  const top = r.results[0];
  assert(top.surface === 'fullscreen-bg', `排第一的 ${top.name} 作用面是 ${top.surface}，不是背景`);
  assert(top.summary, `排第一的 ${top.name} 没有中文摘要`);
  return `${r.results.length} 个候选，首位 ${top.name}`;
});

check('语义索引覆盖全部组件', () => {
  const idx = JSON.parse(fs.readFileSync(path.join(LIB, 'prompts/index.json'), 'utf8'));
  const sem = JSON.parse(fs.readFileSync(path.join(LIB, 'prompts/semantic.json'), 'utf8'));
  assert(sem.total === idx.components.length, `语义 ${sem.total} 个 / 组件 ${idx.components.length} 个，跑 npm run semantic`);
  // 标注不全只警告不失败 —— 新同步进来的组件本来就还没标注
  const gap = sem.total - sem.annotated;
  return gap ? `${sem.annotated}/${sem.total}（${gap} 个待标注）` : `${sem.total} 个全有语义`;
});

console.log('\nskill 安装');

check('install.mjs 能装能卸', () => {
  const fakeHome = path.join(TMP, 'fakehome');
  fs.mkdirSync(fakeHome, { recursive: true });
  const env = { HOME: fakeHome, USERPROFILE: fakeHome };
  run('install.mjs', [], { env });
  const skillDir = path.join(fakeHome, '.claude', 'skills', 'motion-picker');
  assert(fs.existsSync(path.join(skillDir, 'SKILL.md')), 'SKILL.md 没装上');
  const libPath = fs.readFileSync(path.join(skillDir, 'lib-path'), 'utf8').trim();
  assert(path.resolve(libPath) === LIB, `lib-path 指向了别处：${libPath}`);
  run('install.mjs', ['--uninstall'], { env });
  assert(!fs.existsSync(skillDir), '卸载后 skill 目录还在');
  return '装卸都正常';
});

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n${fail ? 'FAILED' : 'PASSED'} — ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
