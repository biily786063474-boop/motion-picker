/**
 * 从源码客观推导组件的结构化特征 —— 不猜、不需要 AI。
 *
 * 这些是「这个效果作用在哪、被什么触发、用什么技术画的」这类事实，
 * 全都能从代码里读出来。语义层面的东西（长什么样、什么气质、
 * 适合什么场景）另说，那个得看图。
 */
import { parseSource } from './resolve.mjs';

/** 效果作用在什么上面 */
export function inferSurface(source, comp) {
  const s = source;
  const wrapsChildren = /\{\s*children\s*\}/.test(s);

  // 文字类要在包裹型之前判。GlitchText / GradientText / ScrambledText / ScrollVelocity
  // 都接 children，但那只是文字的传入方式，它们的作用面就是文字本身 ——
  // 判成 wrapper 会让它们在「故障风格的文字」这类检索里反而被扣分。
  if (comp.category === 'TextAnimations') return 'text';

  // 包裹型：ClickSpark 这类既铺满整块又接 children，
  // 它的效果是「加在你的内容上」而不是「当背景用」，先查 canvas 会判错
  if (wrapsChildren && comp.category !== 'Backgrounds') return 'wrapper';

  // 背景类要在光标类之前判：很多背景也监听鼠标做交互（Silk、Aurora 都是），
  // 但它是「铺在底下的背景」不是「跟着光标跑的东西」
  if (comp.category === 'Backgrounds') return 'fullscreen-bg';
  if (/w-full h-full|width:\s*['"]100%['"]|inset-0/.test(s) && /<canvas|createElement\(['"]canvas/.test(s))
    return 'fullscreen-bg';

  // 光标跟随：监听全局鼠标位置，自己不接内容，也不是背景。
  // 名字兜底 —— BlobCursor 用 gsap 的 quickTo 直接绑，正则匹配不到 addEventListener
  if (!wrapsChildren && (/addEventListener\(['"](?:mousemove|pointermove)['"]/.test(s) || /cursor$/i.test(comp.name)))
    return 'cursor';

  if (/\.map\(/.test(s) && /(items|logos|images|cards|data)\b/.test(s)) return 'collection';
  return 'element';
}

/** 什么时候动起来 */
export function inferTriggers(source) {
  const t = new Set();
  if (/onClick|['"]click['"]/.test(source)) t.add('click');
  if (/onMouseEnter|onPointerEnter|['"]mouseenter['"]|isHovered|onMouseMove|['"]mousemove['"]|['"]pointermove['"]/.test(source))
    t.add('hover');
  if (/ScrollTrigger|['"]scroll['"]|IntersectionObserver|useInView/.test(source)) t.add('scroll');
  if (/requestAnimationFrame|useFrame|gsap\.(?:to|timeline)|setInterval/.test(source)) t.add('ambient');
  if (!t.size) t.add('mount');
  return [...t];
}

/** 用什么画的 —— 决定性能开销和集成复杂度 */
export function inferTech(source, deps) {
  if (deps.some(d => d.startsWith('@react-three/')) || deps.includes('three')) return 'webgl-three';
  if (deps.includes('ogl')) return 'webgl-ogl';
  if (/getContext\(['"]2d['"]\)/.test(source)) return 'canvas-2d';
  if (deps.includes('gsap') || deps.includes('@gsap/react')) return 'dom-gsap';
  if (deps.includes('motion') || deps.includes('framer-motion')) return 'dom-motion';
  if (deps.includes('matter-js')) return 'physics';
  if (/<svg|createElementNS/.test(source)) return 'svg';
  return 'css';
}

/** 从 prop 名和描述里捞实义词，做检索的兜底 */
export function inferKeywords(comp, propsSchema) {
  const words = new Set();

  // 驼峰组件名拆词：LiquidEther → liquid, ether
  for (const w of comp.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/\s+/))
    if (w.length > 2) words.add(w);

  const STOP = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'when', 'each', 'from', 'into', 'controls',
    'component', 'element', 'value', 'values', 'whether', 'enable', 'enables', 'disable',
    'optional', 'additional', 'custom', 'default', 'number', 'string', 'boolean', 'array',
    'object', 'function', 'callback', 'class', 'names', 'name', 'style', 'styles', 'props',
    'prop', 'set', 'sets', 'use', 'used', 'uses', 'can', 'will', 'its', 'per', 'via'
  ]);

  for (const p of propsSchema || []) {
    for (const w of String(p.description || '').toLowerCase().match(/[a-z]{3,}/g) || [])
      if (!STOP.has(w)) words.add(w);
  }
  return [...words].slice(0, 24);
}

/** 一次算完一个组件的全部客观特征 */
export function computeTraits(source, comp, propsSchema) {
  const deps = comp.realDeps || [];
  const tech = inferTech(source, deps);
  return {
    surface: inferSurface(source, comp),
    triggers: inferTriggers(source),
    tech,
    // 有没有持续跑的动画循环 —— 影响性能预算
    continuous: /requestAnimationFrame|useFrame|repeat:\s*-1|infinite/.test(source),
    interactive: /addEventListener\(['"](?:mouse|pointer|touch|click)/.test(source) || /on(?:Click|MouseMove|PointerMove|MouseEnter)/.test(source),
    heavy: ['webgl-three', 'webgl-ogl', 'physics'].includes(tech),
    keywords: inferKeywords(comp, propsSchema)
  };
}
