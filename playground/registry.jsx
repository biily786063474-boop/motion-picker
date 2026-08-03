/**
 * 全量 registry：139 个组件全部接入。
 *
 * 不再手写每一项 —— 组件、源码、prompt 三份都用 import.meta.glob 懒加载，
 * 预览容器（frame）按类目给默认值，只有确实特殊的组件才进 OVERRIDES 表。
 * 这是「O(1) 而不是 O(139)」这条路能不能走通的关键：如果 OVERRIDES 膨胀到几十条，
 * 说明默认值定得不对，应该回头改默认规则而不是继续往表里堆。
 */
import { lazy } from 'react';
import schema from '../prompts/props.json';
import previewOverrides from './preview-overrides.json';

// components/ 是上游镜像（sync 会整目录替换），custom/ 是自有组件（sync 不碰）
const componentLoaders = {
  ...import.meta.glob('../components/**/*.tsx'),
  ...import.meta.glob('../custom/**/*.tsx')
};
const sourceLoaders = {
  ...import.meta.glob('../components/**/*.tsx', { query: '?raw', import: 'default' }),
  ...import.meta.glob('../custom/**/*.tsx', { query: '?raw', import: 'default' })
};
const promptLoaders = import.meta.glob('../prompts/**/*.md', { query: '?raw', import: 'default' });

/**
 * 预览内容。
 *
 * 关键：这些组件多数是「给内容加效果」的（扫光、倾斜、边框光、像素过渡），
 * 效果打在一段透明文字上根本看不出来 —— 必须给一个有背景、有边界、有色彩的实体，
 * 光扫过去才有反射，卡片倾斜才有透视，边框发光才有轮廓。
 */
const Slab = ({ title = '把鼠标移进来试试', hint = '这块内容由预览容器提供，不是组件自带的' }) => (
  <div className="pg-demo-slab">
    <h3>{title}</h3>
    <p>{hint}</p>
  </div>
);

/** 有质感的实体卡片：hover / 扫光 / 倾斜 / 边框光效类必须用它 */
const DemoCard = () => (
  <div className="pg-demo-solid">
    <div className="pg-demo-solid__badge">PREVIEW</div>
    <h3>示例卡片</h3>
    <p>把鼠标移上来，看效果怎么作用在这块内容上</p>
    <div className="pg-demo-solid__swatches">
      <span style={{ background: '#5227FF' }} />
      <span style={{ background: '#06B6D4' }} />
      <span style={{ background: '#F59E0B' }} />
      <span style={{ background: '#EF4444' }} />
    </div>
  </div>
);

/** 图片型：像素过渡 / 倾斜卡片 / 衰减卡片这类要拿图当主体 */
const DEMO_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%235227FF'/%3E%3Cstop offset='0.5' stop-color='%23C084FC'/%3E%3Cstop offset='1' stop-color='%2306B6D4'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='600' height='600' fill='url(%23g)'/%3E%3Ccircle cx='300' cy='250' r='110' fill='%23ffffff' fill-opacity='0.85'/%3E%3Crect x='150' y='420' width='300' height='26' rx='13' fill='%23ffffff' fill-opacity='0.7'/%3E%3C/svg%3E";

const DemoImage = () => <img src={DEMO_IMAGE} alt="示例图片" className="pg-demo-img" />;

/**
 * 一组内联的示例图，给那些默认去 picsum / unsplash 取图的组件用。
 * 外链在离线时不只是「图不显示」—— 改参数触发重新加载还会让组件卡住或坏掉。
 */
const swatch = (a, b, label) =>
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%23${a}'/%3E%3Cstop offset='1' stop-color='%23${b}'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='600' height='600' fill='url(%23g)'/%3E%3Ctext x='300' y='345' font-size='200' font-family='sans-serif' font-weight='bold' fill='%23ffffff' fill-opacity='0.9' text-anchor='middle'%3E${label}%3C/text%3E%3C/svg%3E`;

const DEMO_IMAGES = [
  swatch('5227FF', '9C6BFF', '1'),
  swatch('06B6D4', '3B82F6', '2'),
  swatch('F59E0B', 'EF4444', '3'),
  swatch('10B981', '06B6D4', '4'),
  swatch('EC4899', '8B5CF6', '5')
];

/** 卡片组：ScrollStack 是靠 querySelectorAll('.scroll-stack-card') 抓卡片的，class 少一个就什么都不动 */
const CardStack = () =>
  ['Alpha', 'Beta', 'Gamma', 'Delta'].map(t => (
    <div key={t} className="pg-demo-card scroll-stack-card">
      <h4>{t}</h4>
      <p>示例卡片内容，滚动看堆叠效果</p>
    </div>
  ));

/** 按类目给预览容器的默认形态 */
const FRAME_BY_CATEGORY = {
  Backgrounds: { height: 460, background: '#000' },
  TextAnimations: { height: 300, center: true, background: '#0d0d12' },
  Animations: { height: 380, center: true, background: '#0d0d12' },
  Components: { height: 520, center: true, background: '#060010', scroll: true }
};

/** 文字类组件默认字号太小，统一撑一下 */
const PREVIEW_PROPS_BY_CATEGORY = {
  TextAnimations: { className: 'text-4xl font-semibold' }
};

/**
 * 特例表。只放「按类目默认值渲染不出来 / 明显不合理」的组件。
 * 每条都要写清楚为什么，方便日后回头判断默认规则是不是该改。
 */
const OVERRIDES = {
  // 需要固定尺寸容器，撑满会糊
  SpotlightCard: { frame: { maxWidth: 340, height: 360 }, children: <Slab title="把鼠标移进来" hint="聚光跟随光标移动" /> },
  MagicBento: { frame: { height: 620 }, children: null },
  ClickSpark: {
    frame: { height: 360, center: false },
    children: <Slab title="在这块区域里点一下" hint="ClickSpark 包裹住内容，点击时在光标处炸开火花" />
  },
  // 卡片堆叠类需要多个子元素才看得出效果
  CardSwap: { frame: { height: 520 }, children: <CardStack /> },
  // 3D / 物理类要大一点的舞台
  Lanyard: { frame: { height: 620 } },
  FluidGlass: { frame: { height: 560 } },
  // segments 默认 35 → 175 个 3D transform 图块，选中后整页卡死连切都切不走。
  // 预览容器本来就只露出球面的一小块，降到 14（70 块）视觉上看不出差别
  DomeGallery: { frame: { height: 560 }, previewProps: { segments: 14 } },
  Ballpit: { frame: { height: 520 } },
  Galaxy: { frame: { height: 520 } },
  // 默认 items 是 picsum.photos 外链，离线取不到就是三块空白牌
  FlyingPosters: { previewProps: { items: DEMO_IMAGES.slice(0, 4) } },
  // 组件内部硬编码了 4 张 unsplash 图当默认卡片。注意 cards 的类型是 React.ReactNode[]
  // 而不是数据数组 —— 得直接给 JSX，给 {id,img} 这种对象是没用的
  Stack: {
    frame: { height: 460 },
    previewProps: {
      cards: DEMO_IMAGES.slice(0, 4).map((src, i) => (
        <img key={i} src={src} alt={`card-${i + 1}`} className="w-full h-full object-cover pointer-events-none" />
      ))
    }
  },
  // modelsPath 的 effect 依赖 [modelsPath]，不管 enableWebcam 是不是 false 都会去 CDN 拉
  // face-api 权重（实测挂载一次 10 个请求，改参数重挂又来一轮）。离线时这些请求会挂起很久。
  // 指到本地一个不存在的路径，让它立刻 404 失败 —— 源码有 try/catch，失败只是 setModelsReady(false)，
  // 而 enableWebcam=false 时本来就用不上这些模型。
  GridScan: { previewProps: { modelsPath: '/face-models-not-bundled', enableWebcam: false } },
  // 默认 fontUrl 是 fonts.googleapis.com，离线必然加载失败（巡检里报 ERR_NETWORK_IO_SUSPENDED）。
  // 换成系统字体族，fontUrl 留空让它跳过 @import
  TextPressure: { previewProps: { fontFamily: 'Impact, Haettenschweiler, sans-serif', fontUrl: '' } },
  // 默认 logo 指向上游 /src/assets/... ，那是上游源码树里的路径，这边取不到，给个内联的
  StaggeredMenu: {
    previewProps: {
      logoUrl:
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='24'%3E%3Crect width='80' height='24' rx='4' fill='%235227FF'/%3E%3C/svg%3E"
    }
  },
  // 全屏背景型，撑满不居中
  Aurora: { frame: { center: false, height: 460 } },
  Iridescence: { frame: { center: false, height: 460 } },
  Threads: { frame: { center: false, height: 460 } }
};

/**
 * 只认真正叫 children 的 prop，而且要组件源码里确实接收它。
 *
 * 早先的判断是「props 里有任何 ReactNode 类型的字段就算需要 children」，那是错的：
 * 很多组件的 ReactNode 型 prop 是 icon / logo 之类，跟 children 无关。
 * 结果给 LogoLoop、TextType、Folder 这些根本不渲染 children 的组件塞了内容块，
 * 它们直接丢弃，预览区就只剩一句「把鼠标移进来试试」而看不到任何效果。
 */
const needsChildren = comp =>
  comp.props.some(p => p.name === 'children') &&
  (comp.actualProps ? comp.actualProps.includes('children') : true);

/** preview-overrides.json 里的 childrenKind 是字符串（JSON 存不下 JSX），在这里还原成节点 */
const CHILDREN_KIND = {
  none: null,
  slab: <Slab />,
  cards: <CardStack />,
  // 文字类组件常常把 children 硬包进 <p> 或者直接当字符串处理，
  // 给它们 <Slab>（里面有 h3）会触发 "h3 cannot be a descendant of p"，甚至直接崩
  text: '把这段文字换成你自己的内容',
  card: <DemoCard />,
  image: <DemoImage />,
  'button-label': '点我试试'
};

/** GridScan 只有 named export，没有 default —— 让加载器两种都认 */
const loadComponent = (loader, name) => lazy(() => loader().then(m => ({ default: m.default ?? m[name] })));

export const REGISTRY = schema.components
  .map(comp => {
    // 自有组件在 custom/<类目>/<名字>/<名字>.tsx，多一层目录；上游的是 components/<类目>/<名字>.tsx
    const compPath = comp.custom
      ? `../custom/${comp.category}/${comp.name}/${comp.name}.tsx`
      : `../components/${comp.category}/${comp.name}.tsx`;
    const promptPath = comp.prompt ? `../prompts/${comp.prompt}` : null;
    const loader = componentLoaders[compPath];
    if (!loader) return null;

    // 三层合并：类目默认 → 数据配置（preview-overrides.json，机器生成）→ 手写特例（OVERRIDES）
    const data = previewOverrides[comp.name] || {};
    const override = OVERRIDES[comp.name] || {};
    const frame = {
      ...FRAME_BY_CATEGORY[comp.category],
      ...(data.frameHeight ? { height: data.frameHeight } : {}),
      ...(override.frame || {})
    };
    const previewProps = {
      ...PREVIEW_PROPS_BY_CATEGORY[comp.category],
      ...(data.previewProps || {}),
      ...(override.previewProps || {})
    };

    let children = null;
    if ('children' in override) children = override.children;
    else if (data.childrenKind) children = CHILDREN_KIND[data.childrenKind] ?? null;
    else if (needsChildren(comp)) children = <Slab />;

    return {
      name: comp.name,
      category: comp.category,
      dependencies: comp.dependencies,
      Component: loadComponent(loader, comp.name),
      loadSource: sourceLoaders[compPath],
      loadPrompt: promptPath ? promptLoaders[promptPath] : null,
      frame,
      previewProps,
      children
    };
  })
  .filter(Boolean);

export const REGISTRY_MAP = new Map(REGISTRY.map(r => [r.name, r]));

/** 构建时漏掉的组件要能被发现，不能静默少几个 */
export const MISSING = schema.components
  .filter(
    c =>
      !componentLoaders[
        c.custom
          ? `../custom/${c.category}/${c.name}/${c.name}.tsx`
          : `../components/${c.category}/${c.name}.tsx`
      ]
  )
  .map(c => c.name);
