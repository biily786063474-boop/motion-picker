import { useLayoutEffect, useRef, type ReactNode } from 'react';

export interface RingCarouselItem {
  /** 卡片标题 */
  title?: string;
  /** 卡片副文本 */
  subtitle?: string;
  /** 卡片背景，任意合法 CSS background 值 */
  background?: string;
  /** 自定义卡片内容 */
  content?: ReactNode;
}

export interface RingCarouselProps {
  /** 卡片列表。不传就用内置的 8 张示例 */
  items?: RingCarouselItem[];
  /** 卡片宽度（px） */
  cardWidth?: number;
  /** 卡片高度（px） */
  cardHeight?: number;
  /** 环的半径倍率。1 = 卡片刚好首尾相接，越大环越松 */
  radiusScale?: number;
  /** 透视距离（px）。越小透视越强、纵深越夸张 */
  perspective?: number;
  /** 整体俯仰角（度），负值是从上往下看 */
  tilt?: number;
  /** 滚动一整圈需要几屏 */
  scrollLength?: number;
  /** 追随滚动的弹簧刚度。越大跟得越紧 */
  stiffness?: number;
  /** 阻尼。越小越糯、过冲越明显 */
  damping?: number;
  /** 卡片之间的先后错落量。0 = 整环刚性转动 */
  stagger?: number;
  /** 背面卡片压暗到多少 */
  backDim?: number;
  /** 滚动源：self = 组件自带滚动容器；window = 跟随页面滚动 */
  scroller?: 'self' | 'window';
  /** 附加类名 */
  className?: string;
}

/* ── 缓动语汇 · custom/ 下 6 个动效组件共用，改一处要六处同步 ──────────────
 * 规范见 docs/缓动规范.md。这个组件的「夸张」不来自曲线表，而来自弹簧：
 * 让角度去追滚动位置，而不是直接等于它 —— 惯性、滞后、过冲都是免费的。 */

/** 弹簧一步 —— 半隐式欧拉 */
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

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const PALETTE = [
  'linear-gradient(150deg, #6d3bff 0%, #2a1466 100%)',
  'linear-gradient(150deg, #0f7fa8 0%, #0a2b40 100%)',
  'linear-gradient(150deg, #c2417f 0%, #4a0f36 100%)',
  'linear-gradient(150deg, #16a37b 0%, #0a3b2e 100%)',
  'linear-gradient(150deg, #d1762a 0%, #4a2409 100%)',
  'linear-gradient(150deg, #4257c9 0%, #131d4f 100%)',
  'linear-gradient(150deg, #8e3bd6 0%, #33125c 100%)',
  'linear-gradient(150deg, #b03a3a 0%, #3d0f0f 100%)'
];

const DEFAULT_ITEMS: RingCarouselItem[] = Array.from({ length: 8 }, (_, i) => ({
  title: String(i + 1).padStart(2, '0'),
  subtitle: ['惯性', '滞后', '过冲', '错落', '纵深', '俯仰', '压暗', '回正'][i],
  background: PALETTE[i]
}));

/**
 * 滚动驱动的 3D 环形轮播：卡片沿圆柱面排一圈，滚动带着整环转。
 *
 * 角度不是直接等于滚动位置，而是用弹簧去追 —— 所以起步有滞后、
 * 停下会过冲一点再回正。每张卡的刚度按序微差，整环因此不是刚性一体，
 * 转起来像一串珠子。零依赖，纯 CSS 3D，不用 WebGL。
 */
export default function RingCarousel({
  items = DEFAULT_ITEMS,
  cardWidth = 200,
  cardHeight = 268,
  radiusScale = 1.55,
  perspective = 1100,
  tilt = -6,
  scrollLength = 3,
  stiffness = 90,
  damping = 9,
  stagger = 0.12,
  backDim = 0.32,
  scroller = 'self',
  className = ''
}: RingCarouselProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const list = items.length ? items : DEFAULT_ITEMS;
  const n = list.length;

  useLayoutEffect(() => {
    const host = hostRef.current;
    const track = trackRef.current;
    if (!host || !track) return;

    const step = 360 / n;
    // 半径：让 n 张卡刚好围成一圈，再按 radiusScale 放松
    const radius = (cardWidth / 2 / Math.tan(Math.PI / n)) * radiusScale;

    let raf = 0;
    let disposed = false;
    let last = performance.now();

    // 每张卡一个独立弹簧，刚度按序微差 —— 错落感的来源
    const angles = new Array(n).fill(0);
    const vels = new Array(n).fill(0);

    /**
     * 高度用 px 量出来赋值，不能写百分比。
     * sticky 舞台的包含块是 track，而 track 已经是若干倍屏高 ——
     * 写 height:100% 会让舞台跟着变高，环就跑出可视区了。
     */
    const layout = () => {
      if (scroller !== 'self') return;
      const h = host.clientHeight;
      if (!h) return;
      track.style.height = `${h * Math.max(0.1, scrollLength)}px`;
      if (stageRef.current) stageRef.current.style.height = `${h}px`;
    };

    const readProgress = () => {
      if (scroller === 'self') {
        const max = host.scrollHeight - host.clientHeight;
        return max > 0 ? host.scrollTop / max : 0;
      }
      const r = track.getBoundingClientRect();
      const max = r.height - window.innerHeight;
      return max > 0 ? clamp01(-r.top / max) : 0;
    };

    const frame = (now: number) => {
      if (disposed) return;
      const dt = Math.min(0.05, (now - last) / 1000); // 切走再回来 dt 会巨大，钳住
      last = now;
      layout();

      const p = readProgress();
      const targetAngle = -p * 360 * ((n - 1) / n);

      for (let i = 0; i < n; i++) {
        const el = cardRefs.current[i];
        if (!el) continue;

        // 越靠后的卡刚度越低，跟得越懒 —— 整环就有了先后
        const k = stiffness * (1 - stagger * (i / Math.max(1, n - 1)));
        [angles[i], vels[i]] = springStep(angles[i], vels[i], targetAngle, k, damping, dt);

        const own = i * step + angles[i];
        // 卡片正对镜头的程度：0 完全背对，1 正面
        const facing = (Math.cos((own * Math.PI) / 180) + 1) / 2;

        el.style.transform =
          `rotateY(${own.toFixed(3)}deg) translateZ(${radius.toFixed(2)}px) rotateY(${(-own).toFixed(3)}deg)`;
        el.style.opacity = String(backDim + (1 - backDim) * facing);
        el.style.filter = `brightness(${(0.55 + 0.45 * facing).toFixed(3)})`;
        el.style.zIndex = String(Math.round(facing * 100));
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, [n, cardWidth, radiusScale, scrollLength, stiffness, damping, stagger, backDim, scroller]);

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
        background: '#07060d'
      }}
    >
      <div
        ref={trackRef}
        style={{
          position: 'relative',
          // self 模式的高度由 layout() 用 px 赋，这里只给 window 模式兜底
          height: selfScroll ? undefined : `${Math.max(1, scrollLength) * 100}vh`
        }}
      >
        <div
          ref={stageRef}
          style={{
            position: 'sticky',
            top: 0,
            height: selfScroll ? undefined : '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            perspective: `${perspective}px`
          }}
        >
          <div
            style={{
              position: 'relative',
              width: cardWidth,
              height: cardHeight,
              transformStyle: 'preserve-3d',
              transform: `rotateX(${tilt}deg)`
            }}
          >
            {list.map((it, i) => (
              <div
                key={i}
                ref={el => {
                  cardRefs.current[i] = el;
                }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 18,
                  overflow: 'hidden',
                  background: it.background ?? PALETTE[i % PALETTE.length],
                  border: '1px solid rgba(255,255,255,.14)',
                  boxShadow: '0 24px 60px rgba(0,0,0,.55)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  color: '#fff',
                  willChange: 'transform, opacity, filter',
                  backfaceVisibility: 'hidden'
                }}
              >
                {it.content ?? (
                  <>
                    <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: '0.04em', lineHeight: 1 }}>
                      {it.title}
                    </div>
                    <div style={{ fontSize: 14, opacity: 0.78, letterSpacing: '0.22em' }}>{it.subtitle}</div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
