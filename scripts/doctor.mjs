#!/usr/bin/env node
/**
 * 环境体检：换一台机器跑不起来时，先跑这个。
 *
 * 分两层看 —— 取用组件（拷代码进项目）几乎不需要任何东西，
 * 只有选型台（本地预览 139 个组件）才需要装依赖。
 * 很多人以为必须 npm install 才能用，其实不是。
 *
 *   node scripts/doctor.mjs
 *   node scripts/doctor.mjs --json
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_MODE = process.argv.includes('--json');

const C = {
  ok: s => `\x1b[32m${s}\x1b[0m`,
  bad: s => `\x1b[31m${s}\x1b[0m`,
  warn: s => `\x1b[33m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  b: s => `\x1b[1m${s}\x1b[0m`
};

const checks = [];
const add = (layer, name, ok, detail, fix) => checks.push({ layer, name, ok, detail, fix });

/* ---------- 第一层：取用组件（拷代码进项目） ---------- */

const NODE_MIN = 18;
const nodeMajor = Number(process.versions.node.split('.')[0]);
add(
  'core',
  'Node 版本',
  nodeMajor >= NODE_MIN,
  `v${process.versions.node}`,
  `需要 Node ${NODE_MIN}+（用到了 fs.rmSync 的 recursive 和 ESM）`
);

const need = ['prompts/index.json', 'prompts/props.json', 'components'];
for (const rel of need) {
  const p = path.join(LIB, rel);
  add('core', `资产 ${rel}`, fs.existsSync(p), fs.existsSync(p) ? '在' : '缺失', '库文件不完整，重新 clone 或 git checkout');
}

let idx = null;
try {
  idx = JSON.parse(fs.readFileSync(path.join(LIB, 'prompts/index.json'), 'utf8'));
  const missing = idx.components.filter(c => !fs.existsSync(path.join(LIB, c.localPath)));
  add(
    'core',
    '组件源码完整性',
    missing.length === 0,
    missing.length ? `${missing.length} 个索引里有但文件不在` : `${idx.components.length} 个全在`,
    '跑 npm run sync 重新生成'
  );
} catch (e) {
  add('core', '索引可读', false, e.message.slice(0, 60), '库文件损坏');
}

// 取用路径不该依赖 node_modules —— 这是分发能否轻量的关键
const hasNodeModules = fs.existsSync(path.join(LIB, 'node_modules'));
add('core', '取用是否需要 node_modules', true, hasNodeModules ? '已装（但取用其实用不上）' : '未装（取用照样能跑）', null);

/* ---------- 第二层：选型台（本地可视化预览） ---------- */

add(
  'playground',
  'node_modules',
  hasNodeModules,
  hasNodeModules ? '已装' : '未装',
  '想用选型台就在库目录跑 npm install（约 500MB，只影响预览，不影响取用）'
);

if (hasNodeModules && idx) {
  const pkg = JSON.parse(fs.readFileSync(path.join(LIB, 'package.json'), 'utf8'));
  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const notInstalled = declared.filter(d => !fs.existsSync(path.join(LIB, 'node_modules', d)));
  add(
    'playground',
    '依赖完整性',
    notInstalled.length === 0,
    notInstalled.length ? `缺 ${notInstalled.slice(0, 5).join(' ')}${notInstalled.length > 5 ? ' …' : ''}` : `${declared.length} 个全在`,
    'npm install'
  );
}

const port = Number(process.env.PORT || 5180);
const portFree = await new Promise(resolve => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.once('listening', () => s.close(() => resolve(true)));
  s.listen(port, '127.0.0.1');
});
add('playground', `端口 ${port}`, true, portFree ? '空闲' : '已被占用（可能是选型台自己在跑）', portFree ? null : `被占的话用 PORT=5199 npm run dev 换一个`);

/* ---------- 第三层：skill 接线 ---------- */

const skillDir = path.join(process.env.HOME || '', '.claude/skills/motion-picker');
const skillExists = fs.existsSync(skillDir);
add('skill', 'skill 已安装', skillExists, skillExists ? skillDir.replace(process.env.HOME, '~') : '未安装', '在库目录跑 node install.mjs');

if (skillExists) {
  const pathFile = path.join(skillDir, 'lib-path');
  let recorded = null;
  try {
    recorded = fs.readFileSync(pathFile, 'utf8').trim();
  } catch {}
  const pointsHere = recorded && path.resolve(recorded) === LIB;
  add(
    'skill',
    'skill 指向的库',
    Boolean(pointsHere),
    recorded ? (pointsHere ? '指向本库' : `指向别处：${recorded}`) : 'lib-path 文件缺失',
    '重新跑 node install.mjs'
  );
}

/* ---------- 输出 ---------- */

if (JSON_MODE) {
  const failed = checks.filter(c => !c.ok);
  process.stdout.write(JSON.stringify({ lib: LIB, ok: failed.length === 0, checks }, null, 2) + '\n');
} else {
  const LAYERS = {
    core: ['取用组件', '把组件代码拷进你的项目 —— 这层几乎不需要任何环境'],
    playground: ['选型台', '本地可视化预览 139 个组件 —— 只有想看效果时才需要'],
    skill: ['skill 接线', '让 AI 能自动找到这个库']
  };
  console.log(`\n库位置：${LIB}\n`);
  for (const [layer, [title, note]] of Object.entries(LAYERS)) {
    const items = checks.filter(c => c.layer === layer);
    if (!items.length) continue;
    console.log(`${C.b(title)} ${C.dim(note)}`);
    for (const c of items) {
      const mark = c.ok ? C.ok('✓') : C.bad('✗');
      console.log(`  ${mark} ${c.name.padEnd(24)} ${C.dim(c.detail || '')}`);
      if (!c.ok && c.fix) console.log(`     ${C.warn('→ ' + c.fix)}`);
    }
    console.log('');
  }
  const failed = checks.filter(c => !c.ok);
  const coreFailed = failed.filter(c => c.layer === 'core');
  if (!failed.length) console.log(C.ok('全部就绪\n'));
  else if (!coreFailed.length)
    console.log(C.warn(`${failed.length} 项没就绪，但取用组件不受影响 —— 可以直接用 scripts/add.mjs\n`));
  else console.log(C.bad(`${coreFailed.length} 项核心检查没过，取用会失败\n`));
}

process.exitCode = checks.filter(c => !c.ok && c.layer === 'core').length ? 1 : 0;
