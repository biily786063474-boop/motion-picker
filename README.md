# ReactBits Prompt 离线资产库（TS-TW）

把 [reactbits.dev](https://reactbits.dev) 每个组件页「Copy Prompt」按钮生成的内容，
离线复刻成本地可检索的 markdown 库。方案与取舍见 `docs/reactbits-prompt-抓取方案调研.html`（方案 A）。

## 现状

| 项 | 值 |
|---|---|
| 变体 | 仅 `TS-TW`（TypeScript + Tailwind） |
| 组件数 | 139（Backgrounds 45 / Components 40 / Animations 31 / TextAnimations 23） |
| 体积 | 1.69 MB，单文件平均 12 KB（最大 LiquidEther 44 KB，最小 SpotlightCard 3 KB） |
| 上游 commit | `b9158ac`（2026-07-30） |
| 保真度 | 抽检 9 个组件与线上 Copy Prompt **字节级一致** |

## 目录

```
prompts/
  index.json              检索索引：名称 / 类目 / 依赖 / 站点 URL / 文件路径 / 字节数 / props 数
  props.json              结构化 propData + 站点预览默认值（给 playground 生成控件用）
  .meta.json              上游 commit、抓取时间、脚本版本
  Backgrounds/Orb-TS-TW.md
  Components/  Animations/  TextAnimations/
components/               139 个 TS-TW 组件源码（.tsx，与上游字节一致，可直接拷进项目用）
playground/               可视化选型台（垂直切片，见下）
scripts/
  fetch-repo.sh           STEP 1 取料（幂等，SHA 未变则跳过下载）
  build-prompts.mjs       STEP 2-4 解析 + 复刻 buildPrompt + 落盘
  verify-against-site.mjs 对账：Playwright 点真站按钮读剪贴板，与本地逐字节比对
  audit-controls.mjs      全量跑一遍控件推断，看覆盖率与「范围靠猜」的比例
  shoot-playground.mjs    逐个组件截图 + 抓控制台报错
  verify-playground.mjs   交互验证：真的拖滑块 / 选下拉 / 点预览区 / 验复制内容
.cache/                   上游仓库副本（47 MB，可随时删，跑 fetch-repo.sh 重建）
```

## Playground（139 个组件全量接入）

```bash
npx vite --port 5180 --strictPort    # http://localhost:5180
```

左边选组件 → 中间实时预览 → 右边参数面板（**全自动生成，没有一行是为某个组件写的**）→ 三个复制按钮
（当前参数的用法 / 组件源码 / 完整 prompt）。

全量巡检结果（`node scripts/sweep-all.mjs --shots`）：

| 指标 | 结果 |
|---|---|
| 正常渲染 | **138 / 139** |
| 崩溃 | **0** |
| 像素级空白 | **0**（`scripts/detect-blank.mjs` 逐张分析截图） |
| 调参闪烁 | 拖动 200+ 帧中仅 1 帧重挂（`scripts/verify-remount.mjs`） |
| 生产构建 | 通过（139 个组件全部编译，各自独立分包懒加载） |

唯一那条报错不是组件自身的问题：`Lightfall` 报的是前一位 `LetterGlitch` 卸载后残留的 rAF 抛的，
用 `scripts/verify-isolated.mjs` 单独打开它完全干净。

配置分两层：`playground/preview-overrides.json`（50 个组件的示例数据，机器生成）
+ `playground/registry.jsx` 的 `OVERRIDES`（15 条手写特例）。
**79 个组件完全靠类目默认值跑通，一行配置都不用写** —— 这是「O(1) 而不是 O(139)」这条路走通的证据。

**控件推断的实测覆盖率**（`node scripts/audit-controls.mjs`，跑的是全部 139 个组件 1608 个 prop）：

| 控件 | 数量 | 占比 |
|---|---|---|
| 滑块 | 805 | 50.1% |
| 文本框 | 257 | 16.0% |
| 开关 | 194 | 12.1% |
| 取色器 | 116 | 7.2% |
| JSON 编辑 | 95 | 5.9% |
| 下拉 | 50 | 3.1% |
| 不可调（回调 / ReactNode） | 91 | 5.7% |

**可交互调节 94.3%**。滑块范围的来源：72.4% 靠名字量纲表，4.8% 从 description 里明写的范围抠出来
（如 `threshold (0-1)`），**22.7%（183 个）纯靠默认值猜**——面板上会黄字标出来，用着别扭就单独修那一个。

下拉选项也是从 description 挖的（`Split type: "chars", "words", "lines"`），全量挖出 50 个。

### 全量铺开时踩到的坑

**文档（propData）跟实现（.tsx 源码）到处对不上，一律以源码为准。** 这是最大的一类问题：

| 表现 | 例子 | 处理 |
|---|---|---|
| prop 名拼错 | 文档 `dissappearAfter` / 源码 `disappearAfter` | build 脚本解析源码解构参数，算出 `phantomProps`，playground 不传这些 |
| 默认值是省略写法 | `filterColorMatrixValues: '1 0 0 ...'` | 含 `...` 的默认值视为不可用，不传 |
| 依赖字段漏列 | `CardNav` 实际 import 了 `react-icons`，`dependencies` 里没写 | 用 AST 扫全部源码的真实 import 对账 |
| 默认值跟源码不一致 | `Orb.hoverIntensity` 文档 0.2 / 预览区 2 | 只信 `previewDefaults`，见下 |

**别把文档默认值当真值传给组件。** playground 只传三类：站点 `previewDefaults`（真实跑过的配置）、
`preview-overrides.json` 的示例数据、用户手动改过的。其余一概不传 —— 组件用自己源码里的默认值最安全。

**组件依赖的静态资源要跟着搬**，只拷 `.tsx` 会 500：
- 同目录 import 的（`Lanyard` 的 `card.glb` / `lanyard.png`）→ 跟着源码拷到 `components/`
- 绝对路径引 public 的（`FluidGlass` 的 `/assets/3d/lens.glb`）→ 拷到 `public/`
- `.glb` 要在 `vite.config.mjs` 的 `assetsInclude` 里声明，否则构建报 "not valid UTF-8"

**参数变化不要每次都重挂组件，会闪。** 早先的做法是把所有 props 拼进 `key`，一变就整个卸载重建。
拖滑块时每一次 `onChange` 都触发一轮，实测拖一次 Orb 的 hue，206 帧里有 16 帧预览区是空的
（canvas 被拆掉了），看起来就是一直在闪。现在改成两条路一起走：props 实时传下去（能响应的组件
立刻生效、画面连续），重挂延后到停手 350ms 后只做一次兜底。同样的拖动现在只剩 1 帧空。
回归用 `scripts/verify-remount.mjs`。

**判断组件要不要 children，只能看它有没有叫 `children` 的 prop。** 早先的启发式是
「props 里有任何 ReactNode 类型的字段就算需要」，结果把 `icon`、`logo` 这类也算了进去 ——
给 LogoLoop、TextType、Folder、DecayCard 这些根本不渲染 children 的组件塞了内容块，
它们直接丢弃，预览区就只剩一句「把鼠标移进来试试」。30 个误判，修正后 20 个。

**效果要打在实体上才看得见。** 扫光（GlareHover）、位移（Magnet）、淡入去模糊（FadeContent）
这类是「给内容加效果」的组件，内容是一段透明文字的话，效果等于没有。所以预览内容分了几种形态：
`card`（有背景和边框的实体卡片）、`image`、`text`（纯字符串，给那些把 children 当字符串处理的）、
`cards`、`button-label`、`none`。分配结果在 `preview-overrides.json` 的 `childrenKind`。

**不要给这个 playground 套 `<StrictMode>`。** 它会让每个 effect 挂载两次（挂→卸→再挂）。
预览的是 139 个第三方 WebGL / gsap 组件，它们在 effect 里建 WebGL context、起 rAF 循环、注册全局监听。
Ballpit 的表现最典型：它把 React 持有的 `<canvas ref>` 交给 three，卸载时调 `forceContextLoss()`，
而 StrictMode 第二次挂载时 canvas DOM 节点没重建，`getContext()` 拿回的是同一个已经 lost 的 context，
`getShaderPrecisionFormat()` 返回 null，three 读 `null.precision` 直接崩。
对照组 ColorBends 每次挂载都新建 canvas，所以没事。Hyperspeed 的 `null.alpha` 也是同一类竞态。

**巡检是顺序切换 139 个组件的，上一个组件卸载不干净会把错误算到下一个头上。**
Lightfall 报的 `null.getBoundingClientRect` 其实是它前一位 LetterGlitch 卸载后残留的 rAF 循环抛的
（那个组件的清理函数只 `cancelAnimationFrame`，没清 resize 定时器、也没把 context 置空）。
判断「是它自己的问题还是被连累」只能用 `scripts/verify-isolated.mjs`——全新浏览器直接打开单个组件。

**"不报错" 不等于 "看得见"。** 巡检按「有没有 canvas / 多少个 DOM 节点」判断，会漏掉
Lanyard 这种 canvas 在、不报错、但一个像素都没画的情况。所以有 `scripts/detect-blank.mjs`
直接分析截图像素（唯一色数 + 亮度标准差 + 偏离背景的像素占比）。

**光标跟随类组件不动鼠标就是全黑。** Crosshair / CursorGrid / Ribbons / SplashCursor / LaserFlow
的效果完全由鼠标位置驱动，静态截图必然空白。巡检脚本会在预览区里走一段轨迹再点一下，
否则这 5 个会被误判成坏了。

**组件注入的全局 `<style>` 会撞坏 playground 自己的样式。** 7 个组件会往页面注入全局样式，
DomeGallery 里有一条 `.stage { position: absolute }`，把 playground 的 `.stage`（预览区容器）
变成了覆盖全屏的元素 —— 表现是选中它之后整页点不动、切不走别的组件，看起来像卡死，
实际上左侧列表被盖住了，命中测试全落在 `.stage` 上。所以 playground 的 class 全部带 `pg-` 前缀。
诊断这类问题的关键是查 `document.elementFromPoint()` 返回的是谁，以及对比选中前后各容器的
`getBoundingClientRect()` —— 光看「点不动」会误判成性能问题或事件拦截，我先后错怪了
图块数量（175 个 3D transform）和全局事件监听，都不是。

**巡检脚本每 20 个组件要换一个浏览器。** 一路开下去 WebGL context 会攒爆，实测第 105 个左右整个
tab 崩掉，后面全部误判。

**巡检期间不要改 playground 代码。** dev server 热更新会让正在跑的巡检拿到中间态 —— 我就因为
中途新建了一个 `preview-overrides.json`（registry 已经 import 但文件还没建），
让第二轮前 17 个组件全部误判成「列表里没有」。

**示例数据不能引外部网络资源。** 上游 demo 里用了 `i.pravatar.cc` 这类外链，离线就是一片破图。
`collect-overrides.mjs` 里有一道硬检查，发现 http(s) 链接直接非零退出。

### 踩过的坑（改 inferControl.js 前先读）

- **量纲关键词必须整词匹配，不能用子串**。`duration` 里含 `ratio`（du-**ratio**-n），子串匹配会把它
  判成 0–1 的比例，而它默认值是 400ms —— 滑块容不下当前值，一拖就变成 0.5ms 且再也调不回去。
  现在统一先按驼峰拆词再整词匹配（`tokenize()`）。
- **推断出的范围必须容得下当前值**（`ensureCovers()`）。这是兜底防线，不管哪条规则出错都不会毁掉参数。
  加上这条时救回了 54 处越界。
- **有些量纲取 0 等于「效果消失」**：0 个粒子、0 时长、0 尺寸。这类（`minPositive`）最小值给一个 step
  而不是 0，否则拖到最左边看起来就像坏了。而 delay / offset / gap 取 0 是合法的，保持 0。
- **gsap / WebGL 的错误是在 requestAnimationFrame 里抛的，React ErrorBoundary 抓不到**。
  所以额外挂了全局 `error` / `unhandledrejection` 监听，出错时预览区上方显示红色横幅 + 一键恢复默认参数。
- **JSON 编辑器必须校验类型**。给 gsap 的 `from` 传个字符串或数组，它会在动画回调里抛
  `Failed to set an indexed property on CSSStyleDeclaration`，界面直接坏掉且没有提示。

### 已知限制

- 带 alpha 的颜色（`#ffffff40`）取色器只调 RGB，透明度后缀原样保留，面板上有提示。
- 文字类组件预览字号需要 registry 里给个 `previewProps.className`，否则默认字号看不清。
- 参数改动会重挂组件（WebGL / gsap 多数只在初始化读 props），所以拖滑块时会看到动画重播。

## 用法

**检索**：整库约 50 万 tokens，不要整体入上下文。先查 `index.json`（按类目 / 依赖 / 名称筛），
命中后只读那一个 `.md`。

```bash
# 按依赖找无第三方依赖的组件
node -e "const j=require('./prompts/index.json');console.log(j.byDependency['(无依赖)'].join(', '))"
# 全文检索
grep -rl "scroll" prompts/
```

**重跑（上游更新时）**：

```bash
bash scripts/fetch-repo.sh          # SHA 变了才会重新下载
node scripts/build-prompts.mjs      # 139/139 全成功才算通过，任何解析失败直接非零退出
node scripts/verify-against-site.mjs backgrounds/orb text-animations/split-text components/magic-bento
```

## 漂移风险与应对

`buildPrompt()` 是站点内部函数，作者随时可能改模板。本库是它的二次实现，不会自动跟进。

1. `prompts/.meta.json` 记着复刻自哪个 commit；
2. 重跑前对比 `.cache/react-bits-main/src/components/common/TabsLayout.jsx` 的 `buildPrompt()`
   与 `scripts/build-prompts.mjs` 里那份抄本（当前抄自 `TabsLayout.jsx:63-118`，连空行和步骤编号分支都照抄）；
3. `verify-against-site.mjs` 就是对账工具，抽检失败即说明上游改了模板。

已知需注意的两处：

- `injectPropsIntoCode()` 只在用户手动改过预览区参数时才重写 usage；默认态是恒等映射，
  所以离线复刻能做到字节级相同，脚本里没有复刻它。
- `SpecularButton` 上游 `dependencies` 写成 `npm i ogl`（作者笔误）。prompt 正文照抄原文保真，
  只在 `index.json` 的依赖分类里剥掉命令词。

## 许可

react-bits 为 MIT，组件本就设计成 copy-paste 使用。本库是自用素材库，
保留原始出处（每条索引都带站点 URL），不对外分发、不冒充原创。
