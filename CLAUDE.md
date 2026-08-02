# 交互动效（ReactBits 本地资产库 + 选型台）

**接手前先读 `memory/project_progress.md`** —— 那里有当前进度、待办、和挂起时的状态。

## 这是什么

reactbits.dev 139 个组件的本地化：
- `prompts/` — 每个组件的「Copy Prompt」离线复刻，与线上**字节级一致**
- `components/` — 139 个 TS-TW 源码（可直接拷进项目用，这是「库」本体）
- `playground/` — 可视化选型台，参数面板全自动生成
- `scripts/` — 抓取、巡检、校验管线

## 硬规则

1. **prompt 的字节级一致性不能破坏。** 改 `scripts/build-prompts.mjs` 后必须跑
   `node scripts/verify-against-site.mjs` 与线上对账。`buildPrompt()` 是照抄上游
   `TabsLayout.jsx:63-118` 的，连空行和步骤编号分支都不能动。
2. **以源码为准，不要信 propData。** propData 是给人看的文档，prop 名会拼错、默认值会是
   省略写法、依赖会漏列。playground 只传三类值：站点 `previewDefaults`、
   `preview-overrides.json`、用户手动改过的 —— 其余不传，让组件用自己的默认值。
3. **巡检（`sweep-all.mjs`）跑的时候不要改 playground 代码。** dev server 热更新会让
   正在跑的巡检拿到中间态，整批结果作废。
4. **示例数据不能引外部网络资源。** 这个库要能离线用，图片一律内联 data URI SVG。
   `collect-overrides.mjs` 里有硬检查。
5. **`playground/preview-overrides.json` 是机器生成的**（workflow 产出 → `collect-overrides.mjs` 汇总）。
   手写特例放 `playground/registry.jsx` 的 `OVERRIDES`，别直接改那个 JSON，会被覆盖。
6. **playground 自己的 CSS class 一律带 `pg-` 前缀，新增的也必须带。**
   有 7 个组件（DomeGallery / GooeyNav / MagicBento / ASCIIText / BubbleMenu / StaggeredMenu / TextPressure）
   会往页面注入全局 `<style>`。DomeGallery 里就有一条 `.stage { position: absolute }`，
   曾经把 playground 的 `.stage` 改成覆盖全屏，导致选中它之后整个页面点不动、也切不走
   —— 表现像卡死，实际是布局被撞坏了。`.item` `.app` `.card` `.btn` 这些通用名同样危险。

## 设计原则

参数面板是 **O(1) 不是 O(139)**：139 个组件共用一套 `inferControl.js` 推断，没有一行是为
某个具体组件写的。如果 `OVERRIDES` 膨胀到几十条，说明默认规则定错了，回头改默认规则，
不要继续往表里堆。
