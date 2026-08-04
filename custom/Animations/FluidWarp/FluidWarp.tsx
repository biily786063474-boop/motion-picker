import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface FluidWarpProps {
  /** 被扭曲的内容 */
  children?: ReactNode;
  /** 静止时的扭曲强度（px 位移）。0 = 完全不动 */
  restStrength?: number;
  /** 鼠标划过时能冲到的最大扭曲强度（px 位移） */
  peakStrength?: number;
  /** 噪声粗细。越小纹路越大越像水波，越大越像毛玻璃 */
  scale?: number;
  /** 流动速度。0 = 冻住不流 */
  speed?: number;
  /** 鼠标停下后回弹的黏度。越小回弹越慢越糯 */
  viscosity?: number;
  /** 回弹时的弹性。越大越夸张，会来回过冲几次 */
  elasticity?: number;
  /** 关掉鼠标交互，只留自动流动 */
  still?: boolean;
  /** 附加类名 */
  className?: string;
}

/* ── 缓动语汇 · custom/ 下 6 个动效组件共用，改一处要六处同步 ──────────────
 * 规范见 docs/缓动规范.md。「夸张」来自超调：曲线冲过目标再落回来。
 * 这个组件的回弹是每帧求值的弹簧，不是 CSS 曲线，所以只用得上物理参数。 */

/** 弹簧一步 —— 半隐式欧拉，比 CSS transition 更能表现「冲过头再荡回来」 */
function springStep(
  value: number,
  velocity: number,
  target: number,
  stiffness: number,
  damping: number,
  dt: number
): [number, number] {
  const force = (target - value) * stiffness;
  const nextV = (velocity + force * dt) * Math.exp(-damping * dt);
  return [value + nextV * dt, nextV];
}

/**
 * 交互式流体扭曲：把任意内容浸进一层会流动的介质里，鼠标划过时被搅动，
 * 停手后靠弹簧荡回静止 —— 会过冲几次，所以看起来是「糯」而不是「停」。
 *
 * 零依赖，靠 SVG feTurbulence + feDisplacementMap 实现，没有 WebGL。
 */
export default function FluidWarp({
  children,
  restStrength = 6,
  peakStrength = 42,
  scale = 0.012,
  speed = 0.12,
  viscosity = 3.2,
  elasticity = 9,
  still = false,
  className = ''
}: FluidWarpProps) {
  // filter 的 id 必须全局唯一 —— 同页面挂两个实例会互相抢引用
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const filterId = `fluidwarp-${uid}`;

  const hostRef = useRef<HTMLDivElement>(null);
  const turbRef = useRef<SVGFETurbulenceElement>(null);
  const dispRef = useRef<SVGFEDisplacementMapElement>(null);

  // 初始就给 restStrength，避免第一帧之前是「没有扭曲的原图」造成一次跳变
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    const turb = turbRef.current;
    const disp = dispRef.current;
    if (!host || !turb || !disp) return;

    let raf = 0;
    let disposed = false;
    let last = performance.now();
    let phase = 0;

    // 当前扭曲量 + 速度，鼠标搅动时抬高 target，松手后弹回 restStrength
    let strength = restStrength;
    let velocity = 0;
    let target = restStrength;

    let pointerX = 0.5;
    let pointerY = 0.5;
    let lastPointerX = 0.5;
    let lastPointerY = 0.5;

    const onPointerMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      if (!r.width || !r.height) return;
      pointerX = (e.clientX - r.left) / r.width;
      pointerY = (e.clientY - r.top) / r.height;

      // 划得越快搅得越狠 —— 慢慢挪进来只有轻微涟漪
      const dx = pointerX - lastPointerX;
      const dy = pointerY - lastPointerY;
      const speedNow = Math.min(1, Math.hypot(dx, dy) * 14);
      target = restStrength + (peakStrength - restStrength) * speedNow;
      lastPointerX = pointerX;
      lastPointerY = pointerY;
    };

    const onPointerLeave = () => {
      target = restStrength;
    };

    if (!still) {
      host.addEventListener('pointermove', onPointerMove);
      host.addEventListener('pointerleave', onPointerLeave);
    }

    const frame = (now: number) => {
      if (disposed) return;
      const dt = Math.min(0.05, (now - last) / 1000); // 切标签页回来会有巨大 dt，钳住
      last = now;

      // 搅动量朝 target 弹过去；target 本身也在往 restStrength 泄，
      // 否则鼠标停在原地不动时会一直保持高扭曲
      target += (restStrength - target) * Math.min(1, dt * 2.4);
      [strength, velocity] = springStep(strength, velocity, target, elasticity * 12, viscosity, dt);

      // 让噪声场自己缓慢漂移 = 流动感。两个轴用不同频率，避免看出周期
      phase += dt * speed;
      const bfx = scale * (1 + 0.25 * Math.sin(phase * 1.7));
      const bfy = scale * (1 + 0.25 * Math.cos(phase * 1.1));

      turb.setAttribute('baseFrequency', `${bfx.toFixed(5)} ${bfy.toFixed(5)}`);
      disp.setAttribute('scale', strength.toFixed(2));

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    setReady(true);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [restStrength, peakStrength, scale, speed, viscosity, elasticity, still]);

  return (
    <div ref={hostRef} className={className} style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* 滤镜本体不占版面 */}
      <svg aria-hidden="true" width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }}>
        <defs>
          <filter id={filterId} x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
            <feTurbulence
              ref={turbRef}
              type="fractalNoise"
              baseFrequency={`${scale} ${scale}`}
              numOctaves={2}
              seed={7}
              result="noise"
            />
            <feDisplacementMap
              ref={dispRef}
              in="SourceGraphic"
              in2="noise"
              scale={restStrength}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      <div
        style={{
          width: '100%',
          height: '100%',
          filter: ready ? `url(#${filterId})` : undefined,
          // filter 会开一个新的合成层，提前提示浏览器省得每帧重建
          willChange: 'filter'
        }}
      >
        {children ?? <FluidWarpPlaceholder />}
      </div>
    </div>
  );
}

/** 无参渲染时的占位内容 —— 组件本身不含任何外部资源 */
function FluidWarpPlaceholder() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(120% 120% at 30% 20%, #3b2a7a 0%, #150f2e 55%, #0a0714 100%)',
        color: '#f2ecff',
        fontSize: 'clamp(28px, 7vw, 76px)',
        fontWeight: 700,
        letterSpacing: '0.04em',
        textAlign: 'center',
        lineHeight: 1.15,
        userSelect: 'none'
      }}
    >
      FLUID
      <br />
      WARP
    </div>
  );
}
