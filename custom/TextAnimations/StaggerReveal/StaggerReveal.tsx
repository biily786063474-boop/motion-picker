import { useEffect, useMemo, useRef, useState } from 'react';

/** 错峰次序：谁先动、谁后动 */
export type StaggerFrom = 'start' | 'end' | 'center' | 'edges' | 'random' | 'wave';

/** 每个字的入场姿态 */
export type RevealPreset = 'rise' | 'flip' | 'drop' | 'zoom' | 'swing';

export interface StaggerRevealProps {
  /** 要展示的文字。也可以直接把字符串当 children 传 */
  text?: string;
  children?: string;
  /** 入场姿态 */
  preset?: RevealPreset;
  /** 错峰次序 */
  from?: StaggerFrom;
  /** 相邻两个字的间隔（秒）。这是「错落有致」的主旋钮 */
  stagger?: number;
  /** 单个字的动画时长（秒） */
  duration?: number;
  /** 整体延迟（秒） */
  delay?: number;
  /** 超调力度。0 = 平稳落位，1 = 默认，2 = 非常夸张会明显冲过头 */
  overshoot?: number;
  /** 位移幅度，相对字号。1 = 一个字高 */
  travel?: number;
  /** 滚动进入视口时才播；false = 挂载即播 */
  onView?: boolean;
  /** 触发所需的可见比例 0~1 */
  threshold?: number;
  /** 播完后是否在离开视口时重置，下次再播 */
  replay?: boolean;
  /** 附加类名 */
  className?: string;
}

/* ── 缓动语汇 · custom/ 下 6 个动效组件共用，改一处要六处同步 ──────────────
 * 规范见 docs/缓动规范.md。「夸张」来自超调：曲线冲过 1 再落回来。
 * 这个组件用 CSS transition，所以用得上曲线表本身。 */
const EASE = {
  /** 冲过头再回落 —— 最常用的「有劲」曲线 */
  overshoot: 'cubic-bezier(.34, 1.56, .64, 1)',
  /** 更狠的过冲，会明显荡一下 */
  overshootHard: 'cubic-bezier(.22, 1.85, .36, 1)',
  /** 先反向蓄力再冲出 */
  anticipate: 'cubic-bezier(.68, -.55, .27, 1.55)',
  /** 极快启动、长尾收束，最顺滑，无过冲 */
  glide: 'cubic-bezier(.16, 1, .3, 1)'
} as const;

/** 按超调力度挑曲线：0 平稳 → 1 过冲 → 2 狠过冲 */
function easeFor(overshoot: number): string {
  if (overshoot <= 0.05) return EASE.glide;
  if (overshoot >= 1.6) return EASE.overshootHard;
  return EASE.overshoot;
}

/** 起始姿态：每个字从哪儿来 */
function initialTransform(preset: RevealPreset, travel: number, overshoot: number): string {
  const t = travel;
  switch (preset) {
    case 'flip':
      return `translate3d(0, ${t * 0.45}em, 0) rotateX(-88deg) scale(${1 - 0.12 * overshoot})`;
    case 'drop':
      return `translate3d(0, ${-t}em, 0) scale(${1 + 0.25 * overshoot})`;
    case 'zoom':
      return `translate3d(0, 0, 0) scale(${Math.max(0.05, 1 - 0.85 * Math.max(0.4, overshoot))})`;
    case 'swing':
      return `translate3d(${-t * 0.8}em, ${t * 0.3}em, 0) rotate(${-14 * overshoot}deg)`;
    case 'rise':
    default:
      return `translate3d(0, ${t}em, 0) scale(${1 - 0.18 * overshoot})`;
  }
}

/**
 * 第 i 个字（共 n 个）的错峰次序 0~1 —— 0 最先动。
 * 用确定性的伪随机，同一段文字每次刷新顺序一致，不会看着像坏了。
 */
function orderOf(i: number, n: number, from: StaggerFrom): number {
  if (n <= 1) return 0;
  const last = n - 1;
  switch (from) {
    case 'end':
      return (last - i) / last;
    case 'center':
      return Math.abs(i - last / 2) / (last / 2);
    case 'edges':
      return 1 - Math.abs(i - last / 2) / (last / 2);
    case 'wave':
      // 正弦排布：中间一批先起，两头收尾，节奏比线性更有起伏
      return (1 - Math.cos((i / last) * Math.PI * 2)) / 2;
    case 'random': {
      const h = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
      return h - Math.floor(h);
    }
    case 'start':
    default:
      return i / last;
  }
}

const DEFAULT_TEXT = '错落有致 才有呼吸感';

/**
 * 逐字错峰入场：把文字拆成字符，按指定次序依次落位。
 *
 * 六种错峰次序（顺序/倒序/从中心/从两头/随机/波浪）× 五种入场姿态，
 * 缓动默认带超调 —— 每个字冲过终点再弹回来，所以看着有劲而不是硬停。
 * 零依赖，纯 CSS transition，不用 gsap。
 */
export default function StaggerReveal({
  text = DEFAULT_TEXT,
  children,
  preset = 'rise',
  from = 'start',
  stagger = 0.045,
  duration = 0.9,
  delay = 0,
  overshoot = 1,
  travel = 1,
  onView = true,
  threshold = 0.25,
  replay = false,
  className = ''
}: StaggerRevealProps) {
  // children 是字符串时优先用它，这样 <StaggerReveal>标题</StaggerReveal> 也能写
  const raw = (typeof children === 'string' ? children : undefined) ?? text;
  const hostRef = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(!onView);

  /**
   * 先按空格切词，再把词内切成字符。
   * 词要保持 nowrap，否则英文单词会被逐字拆到两行去。
   */
  const words = useMemo(() => {
    const out: { chars: string[]; space: boolean }[] = [];
    for (const seg of String(raw).split(/(\s+)/)) {
      if (!seg) continue;
      if (/^\s+$/.test(seg)) out.push({ chars: [seg], space: true });
      else out.push({ chars: Array.from(seg), space: false });
    }
    return out;
  }, [raw]);

  const total = useMemo(
    () => words.reduce((sum, w) => sum + (w.space ? 0 : w.chars.length), 0),
    [words]
  );

  useEffect(() => {
    if (!onView) {
      setShown(true);
      return;
    }
    const el = hostRef.current;
    if (!el) return;

    // 环境不支持就直接显示，绝不能让文字停在不可见状态
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }

    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) setShown(true);
          else if (replay) setShown(false);
        }
      },
      { threshold: Math.max(0, Math.min(1, threshold)) }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [onView, threshold, replay]);

  const ease = easeFor(overshoot);
  const hidden = initialTransform(preset, travel, overshoot);

  let charIndex = -1;

  return (
    <span
      ref={hostRef}
      className={className}
      style={{
        display: 'inline-block',
        perspective: '800px',
        // 每个字自己转，透视原点要跟着字走，否则边缘的字会歪得很怪
        perspectiveOrigin: 'center',
        willChange: 'contents'
      }}
    >
      {words.map((w, wi) =>
        w.space ? (
          <span key={`s${wi}`} style={{ whiteSpace: 'pre' }}>
            {w.chars[0]}
          </span>
        ) : (
          <span key={`w${wi}`} style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
            {w.chars.map((ch, ci) => {
              charIndex += 1;
              const d = delay + orderOf(charIndex, total, from) * stagger * total;
              return (
                <span
                  key={ci}
                  aria-hidden="true"
                  style={{
                    display: 'inline-block',
                    transformStyle: 'preserve-3d',
                    transform: shown ? 'none' : hidden,
                    opacity: shown ? 1 : 0,
                    transition: `transform ${duration}s ${ease} ${d}s, opacity ${Math.min(duration, 0.5)}s linear ${d}s`,
                    willChange: 'transform, opacity'
                  }}
                >
                  {ch}
                </span>
              );
            })}
          </span>
        )
      )}
      {/* 逐字拆开后屏幕阅读器会一个字一个字念，给它一份完整的 */}
      <span
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap'
        }}
      >
        {raw}
      </span>
    </span>
  );
}
