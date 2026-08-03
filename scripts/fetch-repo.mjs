#!/usr/bin/env node
/**
 * 取料：把上游 react-bits 拉到 .cache/，记下 commit SHA。
 * 跨平台版本（原来的 fetch-repo.sh 在 Windows 上跑不了）。
 *
 * 幂等：SHA 没变就跳过下载。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(LIB, '.cache');
const REPO_DIR = path.join(CACHE, 'react-bits-main');
const SHA_FILE = path.join(REPO_DIR, '.commit-sha');

/** 走代理时 api.github.com 偶发 SSL_ERROR_SYSCALL，重试几次 */
async function fetchRetry(url, opts = {}, tries = 5) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

console.log('查上游最新 commit…');
const meta = await fetchRetry('https://api.github.com/repos/DavidHDev/react-bits/commits/main').then(r => r.json());
const shaLine = `${meta.sha} ${meta.commit.committer.date}`;

if (fs.existsSync(SHA_FILE) && fs.readFileSync(SHA_FILE, 'utf8').trim() === shaLine) {
  console.log(`已是最新（${meta.sha.slice(0, 7)}），跳过下载`);
  process.exit(0);
}

console.log('下载 tarball（约 47MB）…');
fs.mkdirSync(CACHE, { recursive: true });
const tarGz = path.join(CACHE, 'react-bits.tar.gz');
const res = await fetchRetry('https://codeload.github.com/DavidHDev/react-bits/tar.gz/refs/heads/main');
await pipeline(res.body, fs.createWriteStream(tarGz));

console.log('解压…');
fs.rmSync(REPO_DIR, { recursive: true, force: true });

// tar 在 macOS / Linux / Windows 10+ 都自带；实在没有就提示手工解压
const tarResult = spawnSync('tar', ['xzf', tarGz, '-C', CACHE], { stdio: 'inherit' });
if (tarResult.error || tarResult.status !== 0) {
  console.error(`
解压失败 —— 系统里没有可用的 tar。
请手工把 ${tarGz} 解压到 ${CACHE}，确保得到 ${REPO_DIR}，然后重跑本脚本。`);
  process.exit(1);
}

fs.writeFileSync(SHA_FILE, shaLine + '\n');
console.log(`完成：${shaLine}

提醒：确认上游 src/components/common/TabsLayout.jsx 的 buildPrompt() 没变，
再跑 node scripts/build-prompts.mjs（它照抄了那个函数，上游改了就会漂移）。`);
