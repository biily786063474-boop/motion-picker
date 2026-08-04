import { useLayoutEffect, useRef, type ReactNode } from 'react';

export interface SnapSection {
  /** 主标题 */
  title?: string;
  /** 副标题 */
  subtitle?: string;
  /** 背景，任意合法 CSS background 值 */
  background?: string;
  /** 自定义内容，给了就不用内置排版（内置排版自带三级错峰） */
  content?: ReactNode;
}

export interface SnapSectionsProps {
  /** 分屏列表。不传就用内置的四屏示例 */
  sections?: SnapSection[];
  /** 吸附方式：native = 浏览器原生吸附；spring = 自己弹簧吸附，会过冲 */
  snap?: 'native' | 'spring';
  /** spring 模式下的吸附刚度。越大吸得越快 */
  stiffness?: number;
  /** spring 模式下的阻尼。越小过冲越明显，能荡好几下 */
  damping?: number;
  /** 过冲的视觉幅度（px）。0 = 不表现过冲 */
  overshoot?: number;
  /** 内容进出的位移幅度（px） */
  travel?: number;
  /** 离开时缩到多小 */
  minScale?: number;
  /** 分屏内三级元素的错峰量。0 = 一起到位 */
  stagger?: number;
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

/** 把 [a,b] 区间内的 v 映射到 [0,1]，区间外钳住 */
const range = (v: number, a: number, b: number) => (b === a ? 0 : clamp01((v - a) / (b - a)));

function springStep(
  value: number,
  velocity: number,
  target: number,
  stiffness: number,
  damping: number,
  dt: number
): [number, number] {
  const nextV = (velocity + (target - value) * stiffness * dt) * Math.exp(-damping * dt);
  return [value + nextV * dt, nextV];
}

const DEFAULT_SECTIONS: SnapSection[] = [
  {
    title: '吸附',
    subtitle: '松手就自己对齐到整屏，不会停在半截',
    background: 'linear-gradient(160deg, #241a5e 0%, #0c0820 100%)'
  },
  {
    title: '过冲',
    subtitle: '冲过去一点再荡回来，所以有重量感',
    background: 'linear-gradient(160deg, #0d4257 0%, #061620 100%)'
  },
  {
    title: '错落',
    subtitle: '标题先落位，副标题跟上，装饰线收尾',
    background: 'linear-gradient(160deg, #5a1f4c 0%, #1d0819 100%)'
  },
  {
    title: '不劫持',
    subtitle: '用原生滚动，不接管页面，也不引 lenis',
    background: 'linear-gradient(160deg, #13503c 0%, #051512 100%)'
  }
];

/**
 * 滚动吸附：一屏一屏地吸附对齐，内容按距离屏幕中心的远近进出。
 *
 * 位置吸附交给原生 scroll-snap（最顺滑），过冲感由内层 transform 补偿 ——
 * 于是能做出「冲过去再荡回来」，而滚动位置依然精确落在整屏上。
 * spring 模式则完全自己算吸附，过冲更放肆。零依赖，不接管页面滚动。
 */
export default function SnapSections({
  sections = DEFAULT_SECTIONS,
  snap = 'native',
  stiffness = 120,
  damping = 11,
  overshoot = 26,
  travel = 70,
  minScale = 0.9,
  stagger = 0.16,
  className = ''
}: SnapSectionsProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const innerRefs = useRef<(HTMLDivElement | null)[]>([]);

  const list = sections.length ? sections : DEFAULT_SECTIONS;
  const n = list.length;

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let raf = 0;
    let disposed = false;

    // spring 模式：自己把滚动位置吸到最近一屏，超出的部分用 transform 表现成过冲
    let springPos = host.scrollTop;
    let springVel = 0;
    let settling = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let last = performance.now();

    const paint = (extraShift: number) => {
      const h = host.clientHeight || 1;
      const top = host.scrollTop;

      for (let i = 0; i < n; i++) {
        const el = innerRefs.current[i];
        if (!el) continue;

        // d ∈ [-1,1]：这一屏离视口中心多远
        const d = clamp01(Math.abs(top - i * h) / h) * Math.sign(top - i * h);
        const k = 1 - Math.abs(d);

        const e = easeOutBack(clamp01(k));
        const sc = minScale + (1 - minScale) * e;
        // 过冲位移只给当前这一屏，其它屏不跟着抖
        const shift = Math.abs(d) < 0.5 ? extraShift : 0;
        const ty = -d * travel * (1 - k * 0.3) + shift;

        el.style.transform = `translate3d(0, ${ty.toFixed(2)}px, 0) scale(${sc.toFixed(4)})`;
        el.style.opacity = String(clamp01(k * 1.2));

        // 屏内三级错峰：同一个 k 依次往后推再归一化
        for (let j = 0; j < 3; j++) {
          const part = el.querySelector<HTMLElement>(`[data-part="${j}"]`);
          if (!part) continue;
          const kj = range(k, j * stagger, 1);
          const ej = easeOutBack(kj);
          part.style.opacity = String(clamp01(kj * 1.25));
          part.style.transform = `translate3d(0, ${((1 - ej) * travel * 0.6).toFixed(2)}px, 0)`;
          part.style.filter = kj > 0.99 ? 'none' : `blur(${((1 - easeOutExpo(kj)) * 5).toFixed(2)}px)`;
        }
      }
    };

    const frame = (now: number) => {
      if (disposed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      let extra = 0;
      if (snap === 'spring' && settling) {
        const h = host.clientHeight || 1;
        const target = Math.round(host.scrollTop / h) * h;
        [springPos, springVel] = springStep(springPos, springVel, target, stiffness, damping, dt);

        // scrollTop 会被浏览器钳在 [0, max]，冲不出边界；
        // 把弹簧越界的那部分挪到 transform 上，过冲才看得见
        const maxTop = host.scrollHeight - host.clientHeight;
        const clamped = Math.max(0, Math.min(maxTop, springPos));
        host.scrollTop = clamped;
        extra = (clamped - springPos) * (overshoot / 26);

        if (Math.abs(springPos - target) < 0.4 && Math.abs(springVel) < 6) {
          settling = false;
          springVel = 0;
          host.scrollTop = target;
        }
      }

      paint(extra);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onScroll = () => {
      if (snap !== 'spring') return;
      if (!settling) springPos = host.scrollTop;
      clearTimeout(idleTimer);
      // 手停下来 120ms 后才开始吸附，否则会跟用户的滚动打架
      idleTimer = setTimeout(() => {
        springPos = host.scrollTop;
        springVel = 0;
        settling = true;
      }, 120);
    };

    host.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => paint(0));
    ro.observe(host);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(idleTimer);
      host.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, [n, snap, stiffness, damping, overshoot, travel, minScale, stagger]);

  return (
    <div
      ref={hostRef}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        // spring 模式要自己算吸附，交给原生会两边打架
        scrollSnapType: snap === 'native' ? 'y mandatory' : 'none'
      }}
    >
      {list.map((s, i) => (
        <section
          key={i}
          style={{
            position: 'relative',
            height: '100%',
            scrollSnapAlign: snap === 'native' ? 'start' : undefined,
            scrollSnapStop: snap === 'native' ? 'always' : undefined,
            background: s.background ?? DEFAULT_SECTIONS[i % DEFAULT_SECTIONS.length].background,
            overflow: 'hidden'
          }}
        >
          <div
            ref={el => {
              innerRefs.current[i] = el;
            }}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              padding: '6%',
              textAlign: 'center',
              color: '#f3efff',
              willChange: 'transform, opacity'
            }}
          >
            {s.content ?? (
              <>
                <div
                  data-part="0"
                  style={{
                    fontSize: 'clamp(32px, 7vw, 84px)',
                    fontWeight: 800,
                    letterSpacing: '0.06em',
                    lineHeight: 1.05,
                    willChange: 'transform, opacity, filter'
                  }}
                >
                  {s.title}
                </div>
                <div
                  data-part="1"
                  style={{
                    fontSize: 'clamp(13px, 1.9vw, 18px)',
                    opacity: 0.72,
                    maxWidth: '28em',
                    lineHeight: 1.7,
                    willChange: 'transform, opacity, filter'
                  }}
                >
                  {s.subtitle}
                </div>
                <div
                  data-part="2"
                  style={{
                    width: 'min(200px, 38%)',
                    height: 2,
                    background: 'linear-gradient(90deg, transparent, currentColor, transparent)',
                    opacity: 0.45,
                    willChange: 'transform, opacity, filter'
                  }}
                />
              </>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
