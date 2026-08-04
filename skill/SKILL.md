---
name: motion-picker
description: 需要网页/应用的视觉动效、背景特效、文字动画、交互效果时使用 —— 用户说「加个动效」「要个背景效果」「找个动效参考」「文字动画」「这个页面太素了」「加点交互效果」「炫一点的背景」「过渡效果」，或在做落地页/启动页/登录页/Hero 区/空状态时想要视觉冲击力。先用中文语义检索把 139 个候选收窄到几个（组件名如 Silk / DarkVeil 没有语义，必须查索引不能猜），再打开可视化选型台让人挑效果、调参数看实时预览，选定后把「组件源码 + 调好的参数 + 依赖清单 + 宿主兼容性诊断」交回给 AI，由 AI 按当前项目的技术栈适配并集成。**离线可用，不联网、不生图。**
---

# 动效选型

139 个 ReactBits 组件的本地库 + 可视化选型台。**挑效果这件事必须人来做**（哪个好看、参数调到什么程度合适，AI 判断不了），但挑完之后的适配集成交给 AI。

## 先定位库

库的位置记在 skill 目录里，**不要猜路径**：

```bash
LIB=$(cat ~/.claude/skills/motion-picker/lib-path)
```

后文的 `$LIB` 都指这个。如果这个文件不存在，说明没正确安装 —— 让用户在库目录跑一次 `node install.mjs`。

## 什么时候用

用户想要视觉动效但**说不清具体要哪个**的时候。典型信号：「加个动效」「太素了」「要点视觉冲击」「背景效果」「文字动画」「过渡效果」。

如果用户已经点名了具体组件（「用 Orb」「加个 SplitText」），可以跳过选型台，直接走 §5 的取用。

## 流程

### 1. 先搞清楚给谁用

读目标项目的 `package.json`，拿到 React 版本、有没有 Tailwind、three 版本。这决定了哪些组件能用 —— **不要跳过这步**，否则会推荐用户根本装不上的组件。

### 2. 按需求语义缩小候选

139 个里让人一个个翻是不合理的。用户的话通常已经带了足够信息（「暗色流动的背景」「标题逐字浮现」「鼠标划过发光」），
先把范围收到 3~8 个，人只在这几个里挑。

```bash
node "$LIB"/scripts/add.mjs --find "暗色流动的背景"           # 直接问
node "$LIB"/scripts/add.mjs --find "标题动画" --light          # 只要不吃性能的
node "$LIB"/scripts/add.mjs --find "鼠标跟随" --json           # 给程序解析
```

每条结果带**中文摘要（它长什么样）· 作用面 · 触发方式 · 性能量级 · 依赖**，
够你判断要不要推荐，也够你跟用户复述。

**需求含糊或者你想自己做判断时，改用 `--catalog`：**

```bash
node "$LIB"/scripts/add.mjs --catalog
```

它把 140 条压成十几 KB 的精简全表（名字 / 长什么样 / 作用面 / 气质 / 场景 / 强度 / 依赖），
**整个塞进上下文自己做语义匹配**。这比上面的关键词打分准 —— `--find` 是给不方便调模型的场合用的，
你既然在读这段话，就说明你能读全表。拿不准的时候用 `--catalog`。

匹配时优先考虑这几件事，比「哪个好看」重要：

- **作用面对不对**：要背景就别推 `wrapper`，要文字动画就别推 `fullscreen-bg`
- **宿主装得上吗**：`heavy: true` 的都要 WebGL；React 18 宿主直接排掉 `@react-three/fiber` 那批（见 §6）
- **强度别过头**：后台界面配 `intensity: bold` 的满屏粒子是灾难，默认往 `subtle` 靠

选出候选后**告诉用户你为什么选这几个**，然后开选型台让他定。别自己拍板。

### 3. 写上下文 + 起选型台

```bash
LIB=$(cat ~/.claude/skills/motion-picker/lib-path)
cd "$LIB"
cat > .rb-context.json <<EOF
{ "project": "<目标项目绝对路径>", "projectName": "<项目名>" }
EOF
npm run dev            # http://localhost:5180
```

**选型台需要依赖**（约 500MB）。第一次用如果 `node_modules` 不在，先 `npm install`。
端口被占就 `PORT=5199 npm run dev`。
不想装依赖的话跳过选型台，直接走 §7 的命令行路径 —— 那条路零依赖。

`.rb-context.json` 让选型台顶部实时显示「这个组件在你的项目里能不能用」。没有它选型台照样能开，只是没有兼容性提示。

服务起来后告诉用户地址。如果在 eas-term 里，用 `canvas_open_url` 直接开到画布上。

### 4. 让用户挑

告诉用户：

> 左边选组件（可按名称/类目/依赖搜），中间实时预览，右边调参数。
> 顶部紫条会提示这个组件在你的项目里有没有坑。
> 调到满意后点右上角 **✦ 交给 AI**，然后回来跟我说一声。

**等用户回话，不要自己替他选。** 这一步的全部价值就在于人眼判断。

### 5. 接收选择并集成

用户说选好了之后，读 `"$LIB"/.rb-selection.json`，里面有：

| 字段 | 用途 |
|---|---|
| `component.sourcePath` | 组件源码绝对路径，直接读 |
| `component.promptPath` | 完整集成说明（依赖/用法/props 表/集成步骤） |
| `tunedProps` | **用户调出来的参数**，只含与默认值不同的 —— 这是他要的那个手感，务必保留 |
| `component.realDeps` | 真实依赖（从源码 AST 推导，不是文档抄的） |
| `component.assets` / `publicAssets` | 要跟着走的静态资源 |
| `component.remoteUrls` | 默认值里的外链，离线会失败 |
| `hostWarnings` | 宿主兼容性诊断，逐条处理 |

然后用 CLI 拷进项目：

```bash
node "$LIB"/scripts/add.mjs <组件名> --to <目标目录> --dry-run   # 先看会发生什么
node "$LIB"/scripts/add.mjs <组件名> --to <目标目录>             # 确认后真拷
```

它会带走同目录资源、把 public 资源拷进宿主、盖出处戳、打印要装的依赖、跑一遍体检。
Electron 项目加 `--asset-prefix`（打包后走 `file://`，根绝对路径必挂）。

### 6. 按宿主适配 —— 这才是 AI 该干的活

组件源码是按 React 19 + Tailwind 4 写的，宿主往往不是。逐条处理 `hostWarnings`：

**`missing-tailwind`（95/139 个组件会命中）**
组件会挂载成功但**完全没有样式，控制台一个错都不报**。两条路：给宿主接 Tailwind，或者把组件里的 `className` 改写成宿主的样式方案（CSS Module / styled-components / inline）。改写时注意 Tailwind 的 `group-hover:` `peer-` `[&>canvas]:` 这类复合选择器需要等价改写，不是简单换个类名。

**`r3f-needs-react19`（8 个组件会命中）—— 这是硬阻塞**
`@react-three/fiber` v9 的 peer 写死 `react >=19 <19.3`，React 18 宿主 `npm i` 会直接 ERESOLVE 失败。强行装进去 `<Canvas>` 抛 `Objects are not valid as a React child`，**没有 ErrorBoundary 会把整个 React 树带塌，实测整页全黑**。
出路：装 `@react-three/fiber@^8` + `drei@^9`，或升宿主 React，或换一个零依赖组件（库里有 32 个）。

**`react-version`**
把 `ref` 当普通 prop 接的组件在 React 18 里 ref 会被吃掉，`props.ref` 是 undefined —— 不报错，就是不动。改成 `forwardRef`。

**`remote-urls`**
默认值里的 picsum / unsplash / Google Fonts 外链，开发机联网时正常，打包给离线用户才炸。换成本地资源或内联 data URI。

**`needs-draco`**
用 `useGLTF` 的组件，把 `$LIB/public/draco/` 拷进宿主 public/，入口加 `useGLTF.setDecoderPath('/draco/')`。

**`known-issue`**
`$LIB/scripts/known-issues.json` 里记着已查清但没修的问题（为保持与上游字节一致）。照着 `fix` 字段在下游改。

集成完**按项目规矩构建并打开亲眼看**，别只看编译过了。

## 7. 不用选型台的快捷路径（零依赖）

用户已经点名组件，或者只是想知道有什么：

这条路**不需要 npm install**，克隆下来就能用（依赖信息已预计算进 index.json）：

```bash
node "$LIB"/scripts/add.mjs --find "<需求描述>"  # 语义检索，见 §2
node "$LIB"/scripts/add.mjs --catalog           # 精简全表，自己做匹配
node "$LIB"/scripts/add.mjs --list              # 全部 139 个
node "$LIB"/scripts/add.mjs --list three        # 按关键字/依赖筛
node "$LIB"/scripts/add.mjs --list --no-deps    # 只看零依赖的
node "$LIB"/scripts/add.mjs --list --json       # 给程序解析
```

组件名几乎零语义（Silk / Balatro / DarkVeil / Ferrofluid / Prism），**从名字猜不出效果，也别猜** ——
`--find` 和 `--catalog` 带的中文摘要就是为这个存在的。想亲眼看就开选型台，
或读 `$LIB/.cache/shots/all/<名字>.png`（如果跑过巡检）。

## 程序化调用

核心逻辑在 `$LIB/scripts/lib/add-core.mjs`，纯函数、不碰终端，可以被任何 Node 程序 import：

```js
import { addComponent, listComponents, inspectHost } from '$LIB/scripts/lib/add-core.mjs';
const r = await addComponent({ name: 'Silk', to: '/abs/path', dryRun: true });
```

## 环境不对时

```bash
node "$LIB"/scripts/doctor.mjs
```

它分四层报告：**取用组件**（几乎不需要环境）、**语义检索**、**选型台**（需要 npm install）、**skill 接线**。
只有取用层没过才是真问题（那层挂了 doctor 才退非零）；其余各层没就绪都不影响拷代码进项目。

常见情况：
- **没装依赖** → 取用和 `--find` 照常，选型台不可用。想要选型台就 `npm install`
- **语义索引不全**（doctor 报 `70/140`）→ `--find` 会命不中，用 `--list` 兜底；补法见 `$LIB/docs/运维手册.md`
- **端口被占** → `PORT=5199 npm run dev`
- **Node 太老** → 需要 18+
- **Windows** → 取用和选型台都能跑；只有 `npm run sync`（同步上游）依赖 bash，用 `node scripts/fetch-repo.mjs` 代替

## 边界

- 库里的 `components/` 与上游 react-bits **字节一致**，不要在那里改 bug；改动发生在拷出去的副本里
- 组件是 MIT，拷出去要保留文件头的出处戳
- 这个 skill 不生成任何图像/视频，纯粹是现成 React 组件的选型与集成
- 上游更新用 `npm run sync`（幂等，失败不落盘）
