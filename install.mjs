#!/usr/bin/env node
/**
 * 安装：把 skill 接到 Claude Code，并把库的位置记下来。
 *
 *   node install.mjs             安装
 *   node install.mjs --uninstall 卸载
 *
 * 不装依赖 —— 取用组件本来就不需要。想用选型台再单独 npm install。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const HOME = process.env.HOME || process.env.USERPROFILE;
const SKILL_NAME = 'motion-picker';
const SKILLS_DIR = path.join(HOME, '.claude', 'skills');
const TARGET = path.join(SKILLS_DIR, SKILL_NAME);

const C = { ok: s => `\x1b[32m${s}\x1b[0m`, warn: s => `\x1b[33m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m` };

if (process.argv.includes('--uninstall')) {
  if (fs.existsSync(TARGET)) {
    fs.rmSync(TARGET, { recursive: true, force: true });
    console.log(C.ok(`已卸载 ${TARGET.replace(HOME, '~')}`));
  } else console.log('本来就没装');
  process.exit(0);
}

/* ---- 前置检查 ---- */
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 18) {
  console.error(`需要 Node 18 及以上，当前是 v${process.versions.node}`);
  process.exit(1);
}
if (!HOME) {
  console.error('找不到用户主目录（HOME / USERPROFILE 都没有）');
  process.exit(1);
}
const skillSource = path.join(LIB, 'skill', 'SKILL.md');
if (!fs.existsSync(skillSource)) {
  console.error(`库文件不完整，缺 skill/SKILL.md（当前库：${LIB}）`);
  process.exit(1);
}

/* ---- 安装 ---- */
fs.mkdirSync(SKILLS_DIR, { recursive: true });

if (fs.existsSync(TARGET)) {
  const existing = fs.lstatSync(TARGET);
  const where = existing.isSymbolicLink() ? fs.readlinkSync(TARGET) : '(实体目录)';
  console.log(C.warn(`已存在 ${TARGET.replace(HOME, '~')} → ${where}，将覆盖`));
  fs.rmSync(TARGET, { recursive: true, force: true });
}

// 软链接最省事（改了库里的 SKILL.md 立刻生效），但 Windows 上普通用户可能没权限，
// 那就退回复制 —— 功能一样，只是以后更新库要重新跑一次 install
let mode = 'symlink';
try {
  fs.symlinkSync(path.join(LIB, 'skill'), TARGET, 'dir');
} catch {
  mode = 'copy';
  fs.cpSync(path.join(LIB, 'skill'), TARGET, { recursive: true });
}

// 把库的绝对路径记在 skill 目录里 —— AI 读 SKILL.md 时靠这个文件定位，
// 不用猜路径，也不用要求所有人都把库放在同一个地方
const libPathFile = path.join(mode === 'symlink' ? path.join(LIB, 'skill') : TARGET, 'lib-path');
fs.writeFileSync(libPathFile, LIB + '\n');

/* ---- 报告 ---- */
console.log(`
${C.ok('✓')} ${C.b('motion-picker')} 已安装

  库位置    ${LIB}
  skill     ${TARGET.replace(HOME, '~')} ${C.dim(`(${mode === 'symlink' ? '软链接' : '复制'})`)}

${C.b('现在就能用的')}（不需要装任何依赖）：
  node ${path.relative(process.cwd(), path.join(LIB, 'scripts/add.mjs'))} --list
  node ${path.relative(process.cwd(), path.join(LIB, 'scripts/add.mjs'))} <组件名> --to <目标目录>

${C.b('想用可视化选型台')}（本地预览 139 个组件的效果）：
  cd ${LIB.replace(HOME, '~')} && npm install    ${C.dim('# 约 500MB，只影响预览')}
  npm run dev

${C.dim('环境有问题就跑：node ' + path.relative(process.cwd(), path.join(LIB, 'scripts/doctor.mjs')))}
`);
