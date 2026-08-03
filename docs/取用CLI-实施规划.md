# 取用 CLI 实施规划

> 决策依据：`docs/封装形态评审.md`（五视角评审，A 全票第一、B 全票最后）
> 预算：P0 + P1 一天。超了说明在做不该做的事。

## 一、要做成什么

一条命令把组件从这个库拷进任意项目，代码进你的仓库、随便改：

```bash
node ~/Biily/资产收集/交互动效/scripts/add.mjs Silk --to ~/Biily/Projects/taptv/src/components/effects
```

它不只是 `cp`。它要做 `cp` 做不到的六件事：

1. 同目录资源跟着走（Lanyard 的 `card.glb` 2.4MB + `lanyard.png`）
2. public 资源拷进目标项目并**重写源码里的绝对路径**（FluidGlass 硬编码了 6 个 `/assets/**`，Electron 的 `file://` 下不重写必挂）
3. 依赖清单从**源码 AST** 推导后打印（现有 `dependencies` 字段 11 个组件是错的）
4. **宿主体检警告** —— 整个方案性价比最高的部分，见 §4
5. 文件头盖出处戳（组件名 + 上游 commit + MIT + 取用日期 + 原始 sha256）
6. 往目标项目写一行 `.rb-manifest.json`，记录取过什么

## 二、可嵌入性（三层结构，从第一行代码就这么写）

CLI 要能被别的软件调用，不能只能在终端敲。

```
scripts/lib/add-core.mjs     纯逻辑：addComponent(opts) → 结构化结果
                             不 console.log、不 process.exit、不读 argv
                             所有诊断信息作为返回值的一部分
scripts/lib/resolve.mjs      AST 解析（依赖 / 资源 / 外链），被 core 和 build-prompts 共用
scripts/add.mjs              薄 CLI 外壳：解析 argv → 调 core → 格式化打印
```

**core 的契约**（定死，后面别改）：

```js
import { addComponent, listComponents, inspectHost } from './lib/add-core.mjs';

const result = await addComponent({
  name: 'Silk',
  to: '/abs/path/to/src/components/effects',
  publicDir: '/abs/path/to/public',   // 可选，不给则从 to 往上找
  assetPrefix: '/assets',              // 可选，重写 public 资源路径用
  dryRun: false                        // true = 只算不写，用于预览
});
// →
// {
//   ok: true,
//   written: [{ path, bytes, kind: 'component'|'asset'|'public-asset' }],
//   deps: { missing: ['three'], satisfied: ['gsap'] },
//   warnings: [{ level: 'error'|'warn'|'info', code, message, detail }],
//   manifest: { name, upstreamCommit, sha256, takenAt }
// }
```

三种消费方式：

| 谁调用 | 怎么调 |
|---|---|
| 终端 | `node scripts/add.mjs Silk --to ...` |
| Node / Electron 主进程 / eas-term | `import { addComponent } from '.../add-core.mjs'` |
| 其他语言 / 子进程 | `node scripts/add.mjs Silk --to ... --json` → stdout 一个 JSON |

`--json` 模式下**只有 JSON 走 stdout**，人类可读信息全部走 stderr，保证管道干净。

## 三、原子性（两个层面，都要）

### 3.1 生成管线的原子性（P0-3）

现状是危险的：`build-prompts.mjs` 边跑边就地覆写 `components/` 和 `prompts/`，`process.exit(1)` 在 665 行（所有文件写完之后），全脚本没有任何删除逻辑。上游一年后必然改过，重跑一次若中途有 1 个组件解析失败，你会得到**一半新一半旧、还混着已下架组件残留**的树。

改成：

```
生成到 .tmp-build/ → 全部成功 → 原子替换（rename）→ 删除上游已移除的文件
任何一步失败 → 一个字节都不落盘，退出码非零
```

### 3.2 取用操作的原子性

`addComponent` 一次调用要么全写、要么全不写：

- 先算出完整的写入计划（`written` 数组），**校验全部前置条件**（目标目录可写、文件不存在或允许覆盖、资源源文件存在）
- 全部通过才开始写
- 写入过程中任何失败 → 回滚已写的文件（写之前先记录哪些是新建的）
- `dryRun: true` 走完全部计算和校验，只是不写

### 3.3 任务本身的原子性

下面每个任务独立可验证、可单独回滚。**做完一个 commit 一个。**

## 四、宿主体检（P1-3，别省这一步）

评审里被低估、但实测坐实的头号风险：

> 这个库在 **React 19.2.8 + Tailwind 4 + three 0.180** 上验证。
> 主力项目 taptv 是 **React 18.3.1 + 无 Tailwind + three 0.184**。
> 第一次真实取用大概率「拷贝成功但画面塌」。

体检清单（按实际杀伤力排序）：

| # | 检查 | 触发条件 | 提示 |
|---|---|---|---|
| 1 | 宿主没装 tailwindcss | 组件属于 94/139 带 Tailwind 类的 | 红字 + 两条明路：给宿主上 Tailwind，或手改这个组件的 className |
| 2 | 宿主 React 18 | 组件把 `ref` 当普通 prop 接（ScrollVelocity / GradualBlur） | React 18 会吃掉 ref，`props.ref` 是 undefined，**不报错就是不动** |
| 3 | three 大版本差异 | 组件依赖 three 且宿主已装不同版本 | 列出两边版本 |
| 4 | 默认 props 带外链 | 命中 `remoteUrls` 字段 | 列出具体 prop 和 URL，**只警告不自动替换** |
| 5 | 组件用 useGLTF | 源码含 `useGLTF` | 提示把 `public/draco/` 一起拷，入口加 `useGLTF.setDecoderPath('/draco/')` |
| 6 | 命中已知问题 | `scripts/known-issues.json` | 例：LetterGlitch 的 rAF 清理泄漏会污染下一个挂载的组件 |

## 五、任务清单

每条都写了**验收标准**。没达到就是没做完。

### P0 地基（约 30 分钟）

**T1 · git 化**
- `git init`，`.gitignore` 写 `node_modules/`（538M）、`.cache/`（133M）、`playground/dist/`（15M）
- 首个 commit，打 tag `upstream-b9158ac`
- 验收：`git status` 干净，`du -sh .git` < 20M

**T2 · 补 package.json scripts**
- 现在完全没有 scripts 字段，连 `npm run dev` 都不存在
- 加 `dev` / `build` / `check`（check-deps）/ `sync`（fetch-repo + build-prompts）/ `sweep`（巡检）
- 验收：`npm run dev` 能起服务

**T3 · 生成管线原子写**
- 按 §3.1 改造 `build-prompts.mjs`
- **红线：不许碰 `buildPrompt()`**（CLAUDE.md 硬规则 1）
- 验收：故意让一个组件解析失败，跑完后 `components/` 和 `prompts/` 一个字节都没变；正常跑完后 `verify-against-site.mjs` 3/3 字节级一致

### P1 主体

**T4 · 抽公共解析库 `scripts/lib/resolve.mjs`**
- 搬 `build-prompts.mjs:513-539` 的 `importedAssets()` / `publicAssets()`
- 搬 `check-deps.mjs` 的 AST import 扫描
- **搬，不重写**
- 验收：`build-prompts.mjs` 和 `check-deps.mjs` 都改用它，输出与改造前完全一致

**T5 · index.json 补 5 个字段**

| 字段 | 说明 |
|---|---|
| `localPath` | 现有 `source` 存的是上游路径，照它找文件 100% 落空 |
| `assets` | 同目录资源（只有 Lanyard） |
| `publicAssets` | public 绝对路径资源（只有 FluidGlass 的 6 个） |
| `realDeps` | **AST 推导**，取代从文档抄来的 `dependencies` |
| `remoteUrls` | 默认值里的外链 |

- 保留原 `dependencies` 字段不动（它是上游文档的镜像，两者各司其职）
- 验收：`realDeps` 与 `dependencies` 的差异恰好是已知的 11 个组件；`localPath` 指向的文件 139/139 都存在

**T6 · `scripts/lib/add-core.mjs`**
- 按 §2 的契约实现，按 §3.2 保证原子性
- 验收：`dryRun: true` 不产生任何文件；模拟写入中途失败能完整回滚

**T7 · `scripts/add.mjs`**
- 薄外壳，支持 `--to` / `--public-dir` / `--asset-prefix` / `--dry-run` / `--json` / `--force`
- 验收：`--json` 模式 stdout 是合法 JSON（`| jq` 能解析）

**T8 · 体检警告**
- 按 §4 实现，约 50 行
- 验收：拿 taptv 当宿主跑 `--dry-run`，Tailwind 和 React 18 两条警告必须触发

**T9 · playground 加「复制取用命令」按钮**
- 现有「复制用法」只输出与默认值不同的 prop，这个设计是对的，保留
- 新增按钮输出 `node .../add.mjs Silk --to <路径>`
- 验收：点了能粘贴出可直接执行的命令

**T10 · 拿 taptv 真实冒烟**
- 挑三个：一个零依赖 Tailwind 组件、一个 three 组件、Lanyard（唯一带同目录资源的）
- 按 CLAUDE.md 的规矩**构建并打开应用亲眼看**
- 验收：三个都在 taptv 里跑起来；Tailwind 缺口的实际影响看到画面再定

### P2（可选，前面跑顺了再说）

**T11 · index.json 加 description**
- 组件名（Silk / Balatro / DarkVeil / Ferrofluid / Prism）几乎零语义，AI 拿到「给启动页加个暗色流动背景」映射不过去
- `.cache/shots/all/` 那 139 张截图是现成原料，一次性批量生成
- **不要为此建管线**

## 六、明确不做

- ✗ npm 包（任何形式，含本地 link 和私有 registry）—— 94/139 组件带 Tailwind 类，进 node_modules 后 Tailwind v4 不扫，**静默无样式**
- ✗ submodule / clone 整库进项目
- ✗ 通用补丁层；不为修 bug 去动 `components/`（保住与上游字节一致，那是重跑管线能干净覆盖的前提）
- ✗ 自动替换外链默认值、自动跑 npm install —— 都只打印，让人决策
- ✗ 交互式 TUI、fuzzy search、shadcn 那套 registry 协议 —— 选型入口 playground 已经够好，CLI 只需要 `add` 一个动词
- ✗ 现在建私有仓库 / 往 Mac mini 同步 —— 跨机器只对 npm 包方案才是硬约束
- ✗ 版本号 / CHANGELOG / 发版流程
- ✗ 重写 `buildPrompt()`；不为「修正 prompt 里的错误依赖行」去改 `prompts/`（那是上游文档的字节级镜像，正确数据放 `index.json.realDeps`）

## 六·五、冒烟实测发现（比评审预言更严重）

用一个刻意复现 taptv 配置（React 18 + 无 Tailwind）的临时宿主端到端跑了一遍：

**three 生态组件在 React 18 宿主上不是「画面塌」，是根本装不上。**
`@react-three/fiber` v9.7.0 的 peer 写死 `react >=19 <19.3`，
`npm i @react-three/fiber` 直接 ERESOLVE 失败。强行 `--legacy-peer-deps` 装进去，
`<Canvas>` 渲染时抛 `Objects are not valid as a React child`，
**没有 ErrorBoundary 会把整个 React 树带塌 —— 实测整页全黑，旁边好好的组件也一起没了**。

体检已升级：组件依赖 `@react-three/*` 且宿主 React < 19 → error 级别，给三条出路
（装 fiber@^8、升宿主 React、或换库里 36 个零依赖组件之一）。

这条直接影响 taptv 能用哪些组件：**139 个里 8 个依赖 @react-three/* 生态，在 taptv 现状下取不了；32 个零依赖的随时可取**。

## 七、执行记录

| 任务 | 状态 | 备注 |
|---|---|---|
| T1 git 化 | ✅ | `.git` 6.7M，tag `upstream-b9158ac` |
| T2 package.json scripts | ✅ | `npm run dev` → 200 |
| T3 管线原子写 | ✅ | 失败路径实测校验和不变；对账 3/3 一致 |
| T4 resolve.mjs | ✅ | 删 5300 字符重复实现，产物零差异 |
| T5 index.json 字段 | ✅ | 8 个字段；realDeps 差异恰好 11 个 |
| T6 add-core.mjs | ✅ | dry-run 零副作用；覆盖保护、回滚实测 |
| T7 add.mjs | ✅ | 修了管道截断 bug；--json 87KB 合法 |
| T8 体检警告 | ✅ | Tailwind/React/r3f/外链/draco/已知问题 6 类 |
| T9 playground 按钮 | ✅ | 「取用命令」按钮，剪贴板实测 |
| T10 冒烟 | ✅ | 临时宿主复现 taptv 配置；**taptv 真实集成待你点头** |
| T11 description（可选） | 待办 | |
