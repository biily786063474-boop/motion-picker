import { useLayoutEffect, useRef, type ReactNode } from 'react';

export interface StackCard {
  /** 卡片标题 */
  title?: string;
  /** 卡片正文 */
  body?: string;
  /** 卡片背景，任意合法 CSS background 值 */
  background?: string;
  /** 自定义卡片内容 */
  content?: ReactNode;
}

export interface StackTransitionProps {
  /** 卡片列表。不传就用内置的五张示例 */
  cards?: StackCard[];
  /** 每张卡占多少屏滚动距离。越大转场越慢越从容 */
  scrollPerCard?: number;
  /** 卡片高度占一屏的比例 */
  cardRatio?: number;
  /** 叠起来后每层露出的高度（px） */
  peek?: number;
  /** 每被压一层就缩小多少 */
  scaleStep?: number;
  /** 每被压一层就上移多少（px） */
  liftStep?: number;
  /** 每被压一层就倾斜多少（度），0 = 不倾斜 */
  tiltStep?: number;
  /** 每被压一层压暗多少 */
  dimStep?: number;
  /** 最多显示几层压叠，再往下就不继续缩了 */
  maxDepth?: number;
  /** 入场位移幅度（px） */
  travel?: number;
  /** 超调力度。越大入场时冲过头越明显 */
  overshoot?: number;
  /** 卡片圆角（px） */
  radius?: number;
  /** 滚动源：self = 组件自带滚动容器；window = 跟随页面滚动 */
  scroller?: 'self' | 'window';
  /** 附加类名 */
  className?: string;
}

/* ── 缓动语汇 · custom/ 下 6 个动效组件共用，改一处要六处同步 ──────────────
 * 规范见 docs/缓动规范.md。「夸张」来自超调：曲线冲过 1 再落回来。 */

/** 冲过头再回落（CSS 对应 cubic-bezier(.34,1.56,.64,1)） */
const easeOutBack = (t: number, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;

/** 极快启动、长尾收束（CSS 对应 cubic-bezier(.16,1,.3,1)） */
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const DEFAULT_CARDS: StackCard[] = [
  {
    title: '一张张吸附上来',
    body: '滚动推进，后面的卡片压在前面之上，前面的缩小下沉',
    background: 'linear-gradient(145deg, #6a37e0 0%, #2b1268 100%)'
  },
  {
    title: '入场带过冲',
    body: '卡片滑到位时会冲过一点再落回，所以有重量',
    background: 'linear-gradient(145deg, #0f7ea6 0%, #08293a 100%)'
  },
  {
    title: '层层压暗',
    body: '被压住的每一层都更小、更暗、更偏，纵深就出来了',
    background: 'linear-gradient(145deg, #c2417f 0%, #470f34 100%)'
  },
  {
    title: '不接管滚动',
    body: '用原生滚动，不引 lenis，页面上别的滚动动画照常工作',
    background: 'linear-gradient(145deg, #16a37b 0%, #07362a 100%)'
  },
  {
    title: '零依赖',
    body: '取用就是拷一个文件，不用装任何包',
    background: 'linear-gradient(145deg, #d1762a 0%, #452208 100%)'
  }
];

/**
 * 滚动叠层转场：卡片随滚动一张张吸附到顶部叠成一摞，
 * 后来的压在先来的之上，被压住的逐层缩小、上移、倾斜、压暗。
 *
 * 入场用超调曲线 —— 卡片滑到位会冲过一点再落回来，所以看着有重量。
 * 零依赖，不引 lenis、不接管页面滚动。
 */
export default function StackTransition({
  cards = DEFAULT_CARDS,
  scrollPerCard = 1,
  cardRatio = 0.62,
  peek = 22,
  scaleStep = 0.055,
  liftStep = 14,
  tiltStep = 1.2,
  dimStep = 0.16,
  maxDepth = 4,
  travel = 120,
  overshoot = 1.7,
  radius = 22,
  scroller = 'self',
  className = ''
}: StackTransitionProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const list = cards.length ? cards : DEFAULT_CARDS;
  const n = list.length;

  useLayoutEffect(() => {
    const host = hostRef.current;
    const track = trackRef.current;
    if (!host || !track) return;

    let raf = 0;
    let disposed = false;
    let queued = false;

    /**
     * 高度/偏移全部用 px 量出来赋值，不能写百分比。
     * 卡片的包含块是 track（已经是 n 倍屏高），height:62% 会变成 62% 的 n 倍屏高；
     * 而 margin 的百分比又是相对父元素的「宽度」—— 两个坑叠在一起，只能量。
     */
    const layout = () => {
      if (scroller !== 'self') return;
      const h = host.clientHeight;
      if (!h) return;
      const cardH = h * Math.max(0.2, Math.min(0.95, cardRatio));
      const stepH = h * Math.max(0.3, scrollPerCard);
      track.style.height = `${n * stepH}px`;
      for (let i = 0; i < n; i++) {
        const el = cardRefs.current[i];
        if (!el) continue;
        el.style.height = `${cardH}px`;
        // 每张卡停得比前一张低一点，叠起来才露得出层次
        el.style.top = `${h * 0.08 + i * peek}px`;
        el.style.marginBottom = `${Math.max(0, stepH - cardH)}px`;
      }
    };

    const apply = () => {
      queued = false;
      if (disposed) return;
      layout();

      let p = 0;
      if (scroller === 'self') {
        const max = host.scrollHeight - host.clientHeight;
        p = max > 0 ? host.scrollTop / max : 0;
      } else {
        const r = track.getBoundingClientRect();
        const max = r.height - window.innerHeight;
        p = max > 0 ? clamp01(-r.top / max) : 0;
      }

      // 把 0→1 的进度摊到 n 张卡上：cursor 走到 i 表示第 i 张刚好就位
      const cursor = p * n;

      for (let i = 0; i < n; i++) {
        const el = cardRefs.current[i];
        if (!el) continue;

        // 入场进度：这张卡从下方滑上来的完成度
        const enter = clamp01(cursor - (i - 1));
        // 被压程度：后面每上来一张就多压一层，封顶 maxDepth
        const pressed = Math.min(maxDepth, Math.max(0, cursor - i - 1));

        // easeOutBack 会超过 1，所以卡片会冲过终点再落回 —— 重量感来自这里
        const e = easeOutBack(enter, overshoot);
        const enterY = (1 - e) * travel;

        const scale = 1 - pressed * scaleStep;
        const lift = -pressed * liftStep;
        const tilt = -pressed * tiltStep;
        const dim = Math.max(0, 1 - pressed * dimStep);

        el.style.transform =
          `translate3d(0, ${(enterY + lift).toFixed(2)}px, 0) scale(${scale.toFixed(4)}) rotate(${tilt.toFixed(3)}deg)`;
        el.style.filter = `brightness(${dim.toFixed(3)})`;
        el.style.opacity = String(clamp01(easeOutExpo(clamp01(enter * 1.6))));
        el.style.zIndex = String(i + 1);
      }
    };

    const onScroll = () => {
      if (queued) return;
      queued = true;
      raf = requestAnimationFrame(apply);
    };

    const target: HTMLElement | Window = scroller === 'self' ? host : window;
    target.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    const ro = new ResizeObserver(onScroll);
    ro.observe(host);
    apply();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      target.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      ro.disconnect();
    };
  }, [n, scrollPerCard, cardRatio, peek, scaleStep, liftStep, tiltStep, dimStep, maxDepth, travel, overshoot, scroller]);

  const selfScroll = scroller === 'self';

  return (
    <div
      ref={hostRef}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflowY: selfScroll ? 'auto' : 'visible',
        overscrollBehavior: selfScroll ? 'contain' : 'auto',
        background: '#08060f'
      }}
    >
      <div
        ref={trackRef}
        style={{
          position: 'relative',
          padding: '0 5%',
          // self 模式的高度由 layout() 用 px 赋，这里只给 window 模式兜底
          height: selfScroll ? undefined : `${Math.max(1, n * scrollPerCard) * 100}vh`
        }}
      >
        {list.map((c, i) => (
          <div
            key={i}
            style={{
              position: 'sticky',
              // top / height / marginBottom 由 layout() 按实测像素赋，见上面的注释
              top: selfScroll ? undefined : `calc(8vh + ${i * peek}px)`,
              height: selfScroll ? undefined : `${cardRatio * 100}vh`,
              transformOrigin: 'center top',
              willChange: 'transform, filter, opacity'
            }}
            ref={el => {
              cardRefs.current[i] = el;
            }}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                borderRadius: radius,
                overflow: 'hidden',
                background: c.background ?? DEFAULT_CARDS[i % DEFAULT_CARDS.length].background,
                border: '1px solid rgba(255,255,255,.14)',
                boxShadow: '0 30px 70px rgba(0,0,0,.5)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 14,
                padding: '8%',
                textAlign: 'center',
                color: '#fff'
              }}
            >
              {c.content ?? (
                <>
                  <div
                    style={{
                      fontSize: 'clamp(22px, 4vw, 44px)',
                      fontWeight: 800,
                      letterSpacing: '0.03em',
                      lineHeight: 1.15
                    }}
                  >
                    {c.title}
                  </div>
                  <div style={{ fontSize: 'clamp(12px, 1.6vw, 16px)', opacity: 0.78, maxWidth: '26em', lineHeight: 1.7 }}>
                    {c.body}
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
