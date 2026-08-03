# Motion Picker · 项目规则

给 AI 编程助手配的动效选型台。139 个上游组件 + 自有组件，可视化挑选调参，挑完交给 AI 适配集成。

**动手前先读**：`docs/运维手册.md`（怎么维护、怎么排障）、`docs/组件入库标准.md`（怎么加组件）。

---

## 目录职责（最容易搞错的地方）

| 目录 | 性质 | `npm run sync` |
|---|---|---|
| `components/` | 上游 react-bits 镜像，**生成物** | **整目录替换** |
| `prompts/` | 生成物 | **整目录替换** |
| `custom/` | 自有组件，手写 | 不碰 |
| `public/` | 上游资源 + 手工放的 draco | 逐文件合并，不删 |
| `playground/` `scripts/` `skill/` | 手写 | 不碰 |

**往 `components/` 里加东西 = 白干**，下次同步会被整体替换掉。自有组件放 `custom/`。

---

## 硬规则

### 1 · prompt 的字节级一致性不能破坏

`scripts/build-prompts.mjs` 里的 `buildPrompt()` 是照抄上游 `TabsLayout.jsx:63-118` 的，
连空行和「有 CSS 时步骤编号 3/4/5、没有时 3/4」的分支都不能动。

改过它必须跑 `node scripts/verify-against-site.mjs` 与线上对账，3/3 一致才算过。

### 2 · 以源码为准，不要信文档

上游的 propData 是给人看的文档，跟实现对不上：
- prop 名会拼错（文档 `dissappearAfter` / 源码 `disappearAfter`）
- 默认值是省略写法（`'1 0 0 ...'`）
- 依赖会漏列（**实测 139 个里 11 个不符**，`Silk` 连依赖那行都没有）

依赖、资源、prop 名单一律从 AST 推导（`scripts/lib/resolve.mjs`）。
选型台只传三类值：站点 `previewDefaults`、`preview-overrides.json`、用户手动改过的——
其余不传，让组件用自己源码里的默认值。

### 3 · `components/` 里的 bug 不要就地改

保住「与上游字节一致」，那是「重跑管线 = 干净覆盖」的前提。
发现问题记进 `scripts/known-issues.json`，取用时会打警告，让使用者在自己项目里改。

### 4 · 巡检跑的时候不要改 playground 代码

dev server 热更新会让正在跑的巡检拿到中间态，整批结果作废。踩过一次，10 分钟白跑。

### 5 · 一切资源必须离线可用

不引外部网络（图片、字体、CDN 模型）。图片用内联 data URI。
`collect-overrides.mjs` 和 `validate-component.mjs` 都有硬检查。

**为什么这么严**：外链在开发机上一切正常，打包给离线用户才炸；更阴的是改一个参数触发重新加载就会卡住组件。

### 6 · playground 的 CSS class 一律带 `pg-` 前缀

有 7 个组件会往页面注入全局 `<style>`。`DomeGallery` 里一条 `.stage { position: absolute }`
曾把选型台的 `.stage` 变成覆盖全屏，整页点不动——表现像卡死，实际是布局被撞坏了。
`.item` `.app` `.card` `.btn` 这些通用名同样危险。

### 7 · 不给 playground 套 `<StrictMode>`

双挂载会打死 WebGL context。`Ballpit` 把 React 持有的 canvas 交给 three，
第二次挂载拿回的是已经 lost 的 context，读 `null.precision` 直接崩。

### 8 · `preview-overrides.json` 是机器生成的

workflow 产出 → `collect-overrides.mjs` 汇总。手写特例放 `playground/registry.jsx` 的 `OVERRIDES`。
直接改那个 JSON 会被覆盖。

---

## 设计原则

**参数面板是 O(1) 不是 O(139)。** 139 个组件共用一套 `inferControl.js` 推断，
没有一行是为某个具体组件写的。如果 `OVERRIDES` 膨胀到几十条，说明默认规则定错了，
回头改默认规则，不要继续往表里堆。

**取用路径必须零依赖。** 不装 `node_modules` 也能 `add.mjs`——依赖信息预计算进 `index.json`。
CI 刻意不跑 `npm install` 就是为了守住这条，改坏了立刻红。

**核心逻辑与命令行外壳分离。** `lib/add-core.mjs` 是纯函数（不 `console.log`、不 `process.exit`、
不读 argv），诊断信息都是返回值的一部分，这样它能被 Electron 主进程、eas-term、MCP server 直接 import。

**写入要原子。** 生成管线和取用都是：先算完整计划并校验前置条件 → 全通过才写 → 中途失败回滚。

---

## 验证清单

改完对应的东西，跑对应的验证：

| 改了什么 | 跑什么 |
|---|---|
| CLI / add-core | `npm test`（12 项冒烟） |
| build-prompts | `node scripts/verify-against-site.mjs` |
| playground UI | `npm run sweep` + `npm run verify:playground` |
| inferControl | `npm run check:controls` |
| 加了自有组件 | `npm run validate` + `npm run index:custom` |
| 任何东西 | `npm run doctor` |

UI 类改动**必须构建并打开亲眼看**，不要只看编译过了。

---

## 常用命令

```bash
npm run dev          # 选型台（PORT=5199 换端口）
npm test             # 冒烟测试，不装依赖也能跑
npm run doctor       # 环境体检，三层报告
npm run sync         # 同步上游（幂等，失败不落盘）
npm run validate     # 校验 custom/ 下的组件
npm run sweep        # 全量巡检 + 截图
```
