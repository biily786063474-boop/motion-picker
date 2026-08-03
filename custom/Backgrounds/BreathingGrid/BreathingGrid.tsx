import { useEffect, useRef } from 'react';

export interface BreathingGridProps {
  /** 网格线间距（px） */
  cellSize?: number;
  /** 呼吸一个来回的时长（秒） */
  duration?: number;
  /** 网格线颜色 */
  color?: string;
  /** 最暗时的透明度 */
  minOpacity?: number;
  /** 最亮时的透明度 */
  maxOpacity?: number;
  /** 附加类名 */
  className?: string;
}

/**
 * 一张缓慢呼吸的网格背景。零依赖、纯 canvas，
 * 作为 custom/ 的示例组件，演示自有组件该长什么样。
 */
export default function BreathingGrid({
  cellSize = 48,
  duration = 6,
  color = '#5227FF',
  minOpacity = 0.08,
  maxOpacity = 0.35,
  className = ''
}: BreathingGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let disposed = false;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = parent.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    resize();

    const start = performance.now();
    const draw = (now: number) => {
      if (disposed) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const t = ((now - start) / 1000 / Math.max(0.1, duration)) * Math.PI * 2;
      const wave = (Math.sin(t) + 1) / 2;
      const alpha = minOpacity + (maxOpacity - minOpacity) * wave;

      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= w; x += cellSize) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
      }
      for (let y = 0; y <= h; y += cellSize) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // 清理要干净：残留的 rAF 会在卸载后继续跑，
    // 报错还会算到下一个挂载的组件头上（库里 LetterGlitch 就是这个毛病）
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [cellSize, duration, color, minOpacity, maxOpacity]);

  return <canvas ref={canvasRef} className={`w-full h-full block ${className}`} />;
}
