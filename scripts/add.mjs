#!/usr/bin/env node
/**
 * 把组件从本库拷进任意项目。
 *
 *   node scripts/add.mjs Silk --to ~/Projects/taptv/src/components/effects
 *   node scripts/add.mjs Silk --to ... --dry-run     只看会发生什么，不写文件
 *   node scripts/add.mjs Silk --to ... --json        结构化输出，给程序解析
 *   node scripts/add.mjs --list                      列出全部组件
 *   node scripts/add.mjs --list three                按关键字/依赖筛
 *
 * 这层只负责解析参数和打印。真正的逻辑在 lib/add-core.mjs，
 * 那个模块可以被 Electron 主进程、eas-term、MCP server 直接 import。
 */
import path from 'node:path';
import { addComponent, listComponents, getComponent, LIB_ROOT } from './lib/add-core.mjs';

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const val = (f, d = null) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const JSON_MODE = has('--json');
// --json 模式下 stdout 只能有 JSON，人看的东西全部走 stderr，保证 `| jq` 能用
const say = (...a) => (JSON_MODE ? console.error(...a) : console.log(...a));

/**
 * 往 stdout 写并等它真的落完。
 * 直接 process.stdout.write + process.exit 在管道里会截断 —— 实测 139 个组件的
 * JSON 到 65536 字节就断了，程序调用方拿到的是坏 JSON。
 */
const writeOut = data =>
  new Promise(resolve => {
    if (!process.stdout.write(data)) process.stdout.once('drain', resolve);
    else resolve();
  });

/** 等 stdout 冲干净再退出 */
const exit = async code => {
  await new Promise(r => setTimeout(r, 0));
  process.exit(code);
};

const C = {
  red: s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`
};

/* ---------- --list ---------- */
if (has('--list') || has('-l')) {
  const q = val('--list', '') || val('-l', '') || argv.filter(a => !a.startsWith('-'))[0] || '';
  const hits = listComponents({ query: q, noDeps: has('--no-deps') });
  if (JSON_MODE) {
    await writeOut(JSON.stringify({ total: hits.length, components: hits }, null, 2) + '\n');
  } else {
    const byCat = {};
    for (const c of hits) (byCat[c.category] ||= []).push(c);
    for (const [cat, list] of Object.entries(byCat)) {
      say(`\n${C.bold(cat)} ${C.dim(`(${list.length})`)}`);
      for (const c of list)
        say(`  ${c.name.padEnd(20)} ${C.dim(c.realDeps.length ? c.realDeps.join(' ') : '无依赖')}`);
    }
    say(`\n共 ${hits.length} 个${q ? `（关键字「${q}」）` : ''}`);
  }
  await exit(0);
}

/* ---------- add ---------- */
const name = argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--to' && argv[argv.indexOf(a) - 1] !== '--public-dir' && argv[argv.indexOf(a) - 1] !== '--asset-prefix');

if (!name) {
  say(`用法：
  node scripts/add.mjs <组件名> --to <目标目录> [选项]
  node scripts/add.mjs --list [关键字]

选项：
  --to <dir>            目标目录（必填）
  --public-dir <dir>    宿主 public 目录，默认从 --to 往上找
  --asset-prefix <p>    public 资源的新路径前缀，会同步重写源码里的绝对路径
                        （Electron 打包后走 file://，根绝对路径必挂，这时候要用）
  --dry-run             只算不写，看看会发生什么
  --force               允许覆盖已存在的文件
  --no-stamp            不在文件头盖出处戳
  --json                结构化输出（stdout 只有 JSON）

例：
  node scripts/add.mjs Silk --to ~/Projects/taptv/src/components/effects --dry-run
  node scripts/add.mjs --list three`);
  await exit(1);
}

const to = val('--to');
if (!to) {
  const comp = getComponent(name);
  if (!comp) say(C.red(`库里没有组件 ${name}`));
  else say(C.red('缺少 --to <目标目录>'));
  await exit(1);
}

const result = await addComponent({
  name,
  to,
  publicDir: val('--public-dir'),
  assetPrefix: val('--asset-prefix'),
  dryRun: has('--dry-run'),
  force: has('--force'),
  stamp: !has('--no-stamp')
});

if (JSON_MODE) await writeOut(JSON.stringify(result, null, 2) + '\n');

/* ---------- 人类可读输出 ---------- */
if (result.errors.length) {
  for (const e of result.errors) {
    say(C.red(`✗ ${e.message}`));
    if (e.detail?.near?.length) say(C.dim(`  你是不是想找：${e.detail.near.join(' / ')}`));
  }
  await exit(1);
}

const label = result.dryRun ? C.dim('[dry-run] ') : '';
say(`${label}${C.green('✓')} ${C.bold(result.name)}`);
for (const w of result.written) {
  const kind = { component: '组件', asset: '资源', 'public-asset': 'public 资源', manifest: '取用记录' }[w.kind] || w.kind;
  say(`   ${kind.padEnd(12)} ${w.path.replace(process.env.HOME, '~')} ${C.dim(`${(w.bytes / 1024).toFixed(1)}KB`)}`);
}

if (result.deps.missing.length) {
  say(`\n${C.yellow('需要安装：')}`);
  say(`   npm i ${result.deps.missing.join(' ')}`);
  if (result.deps.satisfied.length) say(C.dim(`   （${result.deps.satisfied.join(' ')} 宿主已有）`));
}

const bad = result.warnings.filter(w => w.level === 'error');
const warn = result.warnings.filter(w => w.level === 'warn');
const info = result.warnings.filter(w => w.level === 'info');

if (bad.length || warn.length || info.length) say('');
for (const w of bad) {
  say(C.red(`✗ ${w.message}`));
  for (const f of w.detail?.fix || []) say(C.dim(`    → ${f}`));
}
for (const w of warn) {
  say(C.yellow(`⚠ ${w.message}`));
  if (w.detail?.detail) say(C.dim(`    ${w.detail.detail}`));
  for (const u of w.detail?.urls || []) say(C.dim(`    ${u}`));
  if (w.detail?.fix) say(C.dim(`    → ${w.detail.fix}`));
}
for (const w of info) {
  say(C.cyan(`· ${w.message}`));
  for (const f of w.detail?.fix || []) say(C.dim(`    → ${f}`));
}

if (result.dryRun) say(C.dim('\n（dry-run，什么都没写。去掉 --dry-run 才会真正拷贝）'));

await exit(result.ok ? 0 : 1);
