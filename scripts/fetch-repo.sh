#!/usr/bin/env bash
# STEP 1 · 取料：把 DavidHDev/react-bits@main 拉到 .cache/react-bits-main，并记下 commit SHA。
# 幂等：SHA 与本地 .commit-sha 相同则跳过下载。
set -euo pipefail
cd "$(dirname "$0")/.."

REPO_DIR=".cache/react-bits-main"
# 走 Clash 代理时 api.github.com 偶发 SSL_ERROR_SYSCALL，加重试
SHA_LINE=$(curl -fsS --retry 5 --retry-all-errors --retry-delay 2 -m 60 \
  https://api.github.com/repos/DavidHDev/react-bits/commits/main \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.sha+' '+j.commit.committer.date)})")

if [ -f "$REPO_DIR/.commit-sha" ] && [ "$(cat "$REPO_DIR/.commit-sha")" = "$SHA_LINE" ]; then
  echo "已是最新（${SHA_LINE%% *}），跳过下载"
  exit 0
fi

mkdir -p .cache
echo "下载 tarball（约 47MB）…"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 -o .cache/react-bits.tar.gz \
  https://codeload.github.com/DavidHDev/react-bits/tar.gz/refs/heads/main
rm -rf "$REPO_DIR"
tar xzf .cache/react-bits.tar.gz -C .cache
echo "$SHA_LINE" > "$REPO_DIR/.commit-sha"
echo "完成：$SHA_LINE"

# 上游改了 buildPrompt 就必须回头核对脚本
echo
echo "提醒：确认 src/components/common/TabsLayout.jsx 的 buildPrompt() 未变更后再重跑 build-prompts.mjs"
