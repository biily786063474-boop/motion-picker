import { useLayoutEffect, useRef, type ReactNode } from 'react';

export interface ScrollScene {
  /** 主标题 */
  title?: string;
  /** 副标题 */
  subtitle?: string;
  /** 场景背景，任意合法 CSS background 值 */
  background?: string;
  /** 自定义内容，给了就不用内置排版（内置排版自带三级错峰） */
  content?: ReactNode;
}

export interface ScrollScenesProps {
  /** 场景列表。不传就用内置的三屏示例 */
  scenes?: ScrollScene[];
  /** 每个场景占多少屏滚动距离。越大切得越慢越从容 */
  scrollPerScene?: number;
  /** 相邻场景的交叠程度。0 = 走完一个才开始下一个，1 = 一直在交叉 */
  overlap?: number;
  /** 进出时的位移幅度（px） */
  travel?: number;
  /** 进出时缩到多小 */
  minScale?: number;
  /** 离场虚化强度（px），0 = 不虚化 */
  blur?: number;
  /** 超调力度。越大越夸张，会冲过终点再弹回来 */
  overshoot?: number;
  /** 场景内三级元素的错峰量。0 = 一起到位 */
  stagger?: number;
  /** 滚动源：self = 组件自带滚动容器；window = 跟随页面滚动 */
  scroller?: 'self' | 'window';
  /** 附加类名 */
  className?: string;
}

/* ── 缓动语汇 · custom/ 下 6 个动效组件共用，改一处要六处同步 ──────────────
 * 规范见 docs/缓动规范.md。「夸张」来自超调：曲线冲过 1 再落回来。
 * 滚动驱动是每帧按进度求值，用不了 CSS 曲线，所以这里是它们的函数版。 */

/** 冲过头再回落。s 越大冲得越过（CSS 对应 cubic-bezier(.34,1.56,.64,1)） */
const easeOutBack = (t: number, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;

/** 极快启动、长尾收束，最顺滑（CSS 对应 cubic-bezier(.16,1,.3,1)） */
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 把 [a,b] 区间内的 v 映射到 [0,1]，区间外钳住 */
const range = (v: number, a: number, b: number) => (b === a ? 0 : clamp01((v - a) / (b - a)));

const DEFAULT_SCENES: ScrollScene[] = [
  {
    title: '滚动',
    subtitle: '每一屏都由滚动进度驱动，不是定时播放',
    background: 'radial-gradient(120% 120% at 20% 15%, #2b1d63 0%, #140d2e 55%, #08060f 100%)'
  },
  {
    title: '错落',
    subtitle: '标题、副标题、装饰线依次到位，不是一起弹出来',
    background: 'radial-gradient(120% 120% at 80% 20%, #0f3f56 0%, #0a2233 55%, #050d14 100%)'
  },
  {
    title: '过冲',
    subtitle: '冲过终点再荡回来，所以看着有惯性而不是硬停',
    background: 'radial-gradient(120% 120% at 50% 85%, #5c2050 0%, #2a0f28 55%, #0d050c 100%)'
  }
];

/**
 * 滚动驱动的场景切换：一屏一屏地推进，每个场景按滚动进度进出，
 * 场景内的标题/副标题/装饰再错峰落位。
 *
 * 零依赖，不引 lenis、不接管页面滚动。默认自带滚动容器，
 * 想跟随整页滚动就把 scroller 设成 'window'。
 */
export default function ScrollScenes({
  scenes = DEFAULT_SCENES,
  scrollPerScene = 1,
  overlap = 0.45,
  travel = 90,
  minScale = 0.86,
  blur = 14,
  overshoot = 1.7,
  stagger = 0.14,
  scroller = 'self',
  className = ''
}: ScrollScenesProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRefs = useRef<(HTMLDivElement | null)[]>([]);

  const list = scenes.length ? scenes : DEFAULT_SCENES;
  const n = list.length;

  // 用 layout effect：首帧就把场景摆到正确位置，否则会闪一下「全部叠在一起」
  useLayoutEffect(() => {
    const host = hostRef.current;
    const track = trackRef.current;
    if (!host || !track) return;

    let raf = 0;
    let disposed = false;
    let queued = false;

    /**
     * 高度必须用 px 量出来赋值，不能写百分比。
     * sticky 舞台的包含块是 track，而 track 已经是 n 倍屏高 ——
     * 写 height:100% 会让舞台也变成 n 倍高，场景直接跑出可视区。
     */
    const layout = () => {
      if (scroller !== 'self') return;
      const h = host.clientHeight;
      if (!h) return;
      track.style.height = `${h * n * Math.max(0.1, scrollPerScene)}px`;
      if (stageRef.current) stageRef.current.style.height = `${h}px`;
    };

    const apply = () => {
      queued = false;
      if (disposed) return;
      layout();

      // 滚动进度 0→1：self 用容器自身，window 用轨道相对视口的位置
      let p = 0;
      if (scroller === 'self') {
        const max = host.scrollHeight - host.clientHeight;
        p = max > 0 ? host.scrollTop / max : 0;
      } else {
        const r = track.getBoundingClientRect();
        const max = r.height - window.innerHeight;
        p = max > 0 ? clamp01(-r.top / max) : 0;
      }

      // 场景 i 的中心落在 i/(n-1) 处；overlap 决定相邻场景交叠多少
      const span = n > 1 ? 1 / (n - 1) : 1;
      const reach = span * (1 + overlap);

      for (let i = 0; i < n; i++) {
        const el = sceneRefs.current[i];
        if (!el) continue;

        const center = n > 1 ? i * span : 0.5;
        // d ∈ [-1,1]：-1 还在前方，0 正当中，1 已经过去
        const d = reach === 0 ? 0 : clamp01(Math.abs(p - center) / reach) * Math.sign(p - center);
        const k = 1 - Math.abs(d); // 0 边缘 → 1 居中

        // easeOutBack 在 k 接近 1 时会超过 1，scale 冲过 1 再落回 —— 夸张感就来自这里
        const e = easeOutBack(clamp01(k), overshoot);
        const sc = minScale + (1 - minScale) * e;
        const ty = -d * travel * (1 - k * 0.35);
        const bl = (1 - easeOutExpo(clamp01(k))) * blur;

        el.style.opacity = String(clamp01(k * 1.15));
        el.style.transform = `translate3d(0, ${ty.toFixed(2)}px, 0) scale(${sc.toFixed(4)})`;
        el.style.filter = bl > 0.15 ? `blur(${bl.toFixed(2)}px)` : 'none';
        el.style.pointerEvents = k > 0.5 ? 'auto' : 'none';
        el.style.zIndex = String(Math.round(k * 100));

        // 场景内三级错峰：把同一个 k 依次往后推一点点再归一化，
        // 于是标题先到位、副标题次之、装饰线最后 —— 这就是「错落有致」
        for (let j = 0; j < 3; j++) {
          const part = el.querySelector<HTMLElement>(`[data-part="${j}"]`);
          if (!part) continue;
          const shift = j * stagger;
          const kj = range(k, shift, 1);
          const ej = easeOutBack(kj, overshoot);
          part.style.opacity = String(clamp01(kj * 1.2));
          part.style.transform = `translate3d(0, ${((1 - ej) * travel * 0.55).toFixed(2)}px, 0)`;
        }
      }
    };

    // scroll 事件可能一帧来好几次，合并到一帧里做
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
  }, [n, scrollPerScene, overlap, travel, minScale, blur, overshoot, stagger, scroller]);

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
        // 自带滚动容器时不要让滚动链传给外层页面
        overscrollBehavior: selfScroll ? 'contain' : 'auto'
      }}
    >
      <div
        ref={trackRef}
        style={{
          position: 'relative',
          // self 模式的高度由 layout() 用 px 赋，这里只给 window 模式兜底
          height: selfScroll ? undefined : `${Math.max(1, n * scrollPerScene) * 100}vh`
        }}
      >
        <div
          ref={stageRef}
          style={{
            position: 'sticky',
            top: 0,
            height: selfScroll ? undefined : '100vh',
            overflow: 'hidden'
          }}
        >
          {list.map((s, i) => (
            <div
              key={i}
              ref={el => {
                sceneRefs.current[i] = el;
              }}
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '18px',
                padding: '6%',
                textAlign: 'center',
                background: s.background ?? DEFAULT_SCENES[i % DEFAULT_SCENES.length].background,
                color: '#f4f0ff',
                willChange: 'transform, opacity, filter'
              }}
            >
              {s.content ?? (
                <>
                  <div
                    data-part="0"
                    style={{
                      fontSize: 'clamp(34px, 8vw, 92px)',
                      fontWeight: 800,
                      letterSpacing: '0.06em',
                      lineHeight: 1.05,
                      willChange: 'transform, opacity'
                    }}
                  >
                    {s.title}
                  </div>
                  <div
                    data-part="1"
                    style={{
                      fontSize: 'clamp(13px, 2vw, 19px)',
                      opacity: 0.72,
                      maxWidth: '30em',
                      lineHeight: 1.7,
                      willChange: 'transform, opacity'
                    }}
                  >
                    {s.subtitle}
                  </div>
                  <div
                    data-part="2"
                    style={{
                      width: 'min(220px, 40%)',
                      height: '2px',
                      background: 'linear-gradient(90deg, transparent, currentColor, transparent)',
                      opacity: 0.5,
                      willChange: 'transform, opacity'
                    }}
                  />
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
