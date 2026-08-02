# 交互动效 · 项目进度

## 2026-08-01 全量铺开（进行中，已挂起）

### 项目是什么

把 reactbits.dev 的 139 个组件做成**本地自用资产库 + 可视化选型台**。
目标形态：先自用，效果可以之后集成进 eas-term 画布。方案与取舍见
`docs/reactbits-prompt-抓取方案调研.html`（选的方案 A · 只出 TS-TW 一套）。

### 已完成

**① prompt 离线复刻（完成，已验证）**
- `prompts/` 139 个 TS-TW markdown，与线上 Copy Prompt **字节级一致**（抽检 9 个）
- `prompts/index.json` 检索索引、`prompts/props.json` 结构化元数据、`prompts/.meta.json` 上游 commit
- 上游 commit `b9158ac`（2026-07-30）

**② 组件库落盘（完成）**
- `components/` 139 个 `.tsx` 源码，与上游字节一致
- 随源码搬运的静态资源：`components/Components/card.glb`、`lanyard.png`
- `public/assets/` 6 个（FluidGlass 的 lens/bar/cube.glb、cs1~3.webp）

**③ playground 垂直切片（完成，已验证）**
- 参数面板全自动生成，139 个组件共用一套推断（`playground/inferControl.js`）
- 实测覆盖率：1608 个 prop 中 **94.3% 可交互调节**
- 5 个代表组件跑通全链路，交互验证 7/7 通过

**④ 全量铺开（进行中）**
- 依赖装齐：19 个组件依赖 + react-icons + react-router-dom
- `playground/registry.jsx` 已改成全量（`import.meta.glob` + 类目默认 frame + OVERRIDES 特例表）
- **全量生产构建通过**（139 个组件全部编译，`npx vite build` ✓）
- workflow 已产出 `playground/preview-overrides.json`（46 个组件的示例数据配置）

### 2026-08-01 全量铺开完成

139 个组件全部接入 playground，最终巡检：**正常 137 / 崩溃 0 / 像素级空白 0**，生产构建通过。
配置分布：机器生成 50 个 + 手写特例 15 个 + **79 个完全靠类目默认值跑通**。

这一轮修掉的系统性问题（详见 README「全量铺开时踩到的坑」）：
1. 组件注入的全局 `<style>` 撞坏 playground 样式 → 所有 class 加 `pg-` 前缀
2. StrictMode 双挂载打死 WebGL context → 移除 StrictMode（修好 Ballpit / Hyperspeed）
3. propData 与源码不一致 → 只传可信值（previewDefaults + overrides + 用户改动）
4. GridScan 没有 default export → registry 兼容 named export
5. 静态资源没搬（同目录 import + public 绝对路径）→ build 脚本自动拷贝
6. Ferrofluid 的 propData 有重名 prop → 面板生成 controls 时去重
7. 光标类组件不动鼠标就全黑 → 巡检加鼠标轨迹
8. 巡检 WebGL context 攒爆 → 每 20 个换浏览器

剩余 2 条报错都已查清、都不是组件自身问题：
- `Lightfall` — 前一位 `LetterGlitch` 卸载残留的 rAF 抛的（隔离测试它自己干净）。
  根因在 LetterGlitch 的清理函数（只 cancelAnimationFrame，没清 resize 定时器）。
  没修，因为 `components/` 要与上游保持字节一致。
- `TextPressure` — 默认字体来自 Google Fonts，离线失败，已在 registry 换成系统字体族。

### 2026-08-01 用户反馈的两个体验问题（已修）

**① 调参时画面闪烁** —— 根因是「参数一变就把所有 props 拼进 key 整个重挂组件」。
拖滑块时每次 onChange 都触发一轮卸载重建，实测 Orb 拖一次 hue，206 帧里 16 帧预览区是空的。
改成：props 实时传（能响应的组件立即生效）+ 重挂 debounce 350ms 只做一次兜底。修复后同样拖动只剩 1 帧。
回归脚本 `scripts/verify-remount.mjs`。

**② 很多包裹型组件「没内容没效果」** —— 两个原因叠加：
- `needsChildren` 判断错了：原来是「有任何 ReactNode 类型 prop 就算需要 children」，
  把 icon/logo 也算了进去，给 10 个根本不渲染 children 的组件（LogoLoop / TextType / Folder / DecayCard…）
  塞了内容块，它们直接丢弃。改成只认真正叫 children 且源码确实解构了它的。
- 内容本身没有视觉重量：扫光/位移/淡入这类效果打在透明文字上等于没有。
  新增 `card`（实体卡片）/ `image` / `button-label` 三种预览内容形态，由 workflow 逐个判断该给哪种。

workflow 顺带发现的具体问题：DecayCard 默认图是 picsum 外链（离线取不到，换成 /assets/demo/cs1.webp）、
LogoLoop 渐隐色默认白色（暗色台上糊白边）、PixelTransition 的 firstContent/secondContent 没传导致两层全空、
ScrollStack 靠 `.scroll-stack-card` 抓卡片（我的 CardStack 少这个 class 所以什么都不动）。

最终巡检：**正常 138 / 139，崩溃 0，像素级空白 0**。

### 挂起时的状态（历史记录，已完成）

**第三轮全量巡检正在后台跑**（`scripts/sweep-all.mjs --shots`），
日志在 `/tmp/claude-501/-Users-biily-Biily----------/671f00e1-f157-4ecc-a67c-043bbd33cf08/scratchpad/sweep3.log`，
结果落 `.cache/sweep.json` + 截图 `.cache/shots/all/`。挂起时进度 32/139。
**下次先看这个结果**，它是判断还剩多少问题的唯一依据（前两轮的结果都已作废，原因见下）。

### 待办（按优先级）

1. **重跑 `node scripts/collect-overrides.mjs <workflow目录>`**
   我第一次跑它时复核阶段还没结束，`corrected=0`；workflow 最终报告 `corrected=1`，
   说明有 1 处复核修正**还没吸收进** `preview-overrides.json`。
   workflow 目录：`~/.claude/projects/-Users-biily-Biily----------/671f00e1-f157-4ecc-a67c-043bbd33cf08/subagents/workflows/wf_b367d114-de2`
2. **4 个组件的示例数据没经过复核**（workflow 里这 4 个复核 agent 因 API 证书错误挂了）：
   `BounceCards`、`LogoLoop`、`ProfileCard`、`PixelTransition`。它们的 previewProps 是一遍过的产物，字段名没人核对过。
3. 根据第三轮巡检结果修剩余问题组件。挂起前已知未解决的（第二轮发现，第三轮结果待确认）：
   - `Ballpit` — Cannot read properties of null (reading 'precision')
   - `GridScan` — Cannot convert object to primitive value
   - `Hyperspeed` — null.alpha（需要完整的 effectOptions 配置对象）
   - `Lightfall` — null.getBoundingClientRect
   - `Ferrofluid` — 重复 key（phantomProps 里有两个 backgroundColor）
   - `ModelViewer` — Unsupported format（需要 .glb 模型，项目里没有）
   - `DecayCard` / `CardNav` — 空字符串传给了 image 属性
   注意：这些是在「只传可信值」改动**之前**发现的，那个改动可能已经修掉一部分。
4. 逐类目人工看截图（`.cache/shots/all/`），确认视觉效果而不只是「不报错」
5. 全部通过后更新 README 的覆盖率数字

### 这次踩的坑（详细版在 README.md「全量铺开时踩到的坑」）

- **文档（propData）跟源码到处对不上**，一律以源码为准。已实现三道防线：
  `phantomProps`（prop 名拼错）、含 `...` 的默认值不传、AST 扫真实 import 对账依赖
- **别把文档默认值当真值传给组件**。playground 现在只传三类：`previewDefaults`（站点真跑过的）、
  `preview-overrides.json`、用户手动改过的。其余不传，让组件用自己源码里的默认值
- **巡检期间绝对不能改 playground 代码** —— 我中途新建了一个 registry 已 import 但还不存在的
  JSON 文件，dev server 热更新后 app 崩了，导致第二轮前 17 个组件全部误判成「列表里没有」
- **巡检每 20 个组件要换一个浏览器**，否则 WebGL context 攒爆，第 105 个左右整个 tab 崩掉（第一轮就这么废的）

### 怎么跑起来

```bash
npx vite                                    # http://localhost:5180
node scripts/sweep-all.mjs --shots          # 全量巡检 + 截图
node scripts/audit-controls.mjs             # 控件推断覆盖率审计
node scripts/verify-playground.mjs          # 5 个代表组件的交互回归
node scripts/verify-against-site.mjs        # 与线上 Copy Prompt 逐字节对账
```
