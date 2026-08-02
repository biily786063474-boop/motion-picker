## Integrate the <Shuffle /> component from React Bits

You are helping integrate an open-source React component into an existing application.

### Component: Shuffle
### Variant: TypeScript + Tailwind
### Dependencies: gsap @gsap/react

---

### Usage Example
```jsx
import Shuffle from './Shuffle';

<Shuffle
  text="Hello World"
  shuffleDirection="right"
  duration={0.35}
  animationMode="evenodd"
  shuffleTimes={1}
  ease="power3.out"
  stagger={0.03}
  threshold={0.1}
  triggerOnce={true}
  triggerOnHover={true}
  respectReducedMotion={true}
/>
```

### Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| text | string | "" | The text content to shuffle. |
| className | string | "" | Optional CSS class for the wrapper element. |
| style | object | {} | Inline styles applied to the wrapper element. |
| shuffleDirection | "left" | "right" | "up" | "down" | "right" | Direction the per-letter strip slides to reveal the final character. |
| duration | number | 0.35 | Duration (s) of the strip slide per letter. |
| maxDelay | number | 0 | Max random delay per strip when animationMode = "random". |
| ease | string | Function | "power3.out" | GSAP ease for sliding and color tween. |
| threshold | number | 0.1 | Portion of the element that must enter view before starting. |
| rootMargin | string | "-100px" | ScrollTrigger start offset (px, %, etc.). |
| tag | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span" | "p" | HTML tag to render for the text container. |
| textAlign | CSS text-align | "center" | Text alignment applied via inline style. |
| onShuffleComplete | () => void | undefined | Called after a full run completes (and on each loop repeat). |
| shuffleTimes | number | 1 | How many interim scrambled glyphs to scroll past before the final char. |
| animationMode | "evenodd" | "random" | "evenodd" | Odd/even staggered strips or random per-strip delays. |
| loop | boolean | false | Repeat the shuffle indefinitely. |
| loopDelay | number | 0 | Delay (s) between loop repeats. |
| stagger | number | 0.03 | Stagger (s) for strips in "evenodd" mode. |
| scrambleCharset | string | "" | Characters to use for interim scrambles; empty keeps original copies. |
| colorFrom | string | undefined | Optional starting text color while shuffling. |
| colorTo | string | undefined | Optional final text color to tween to. |
| triggerOnce | boolean | true | Auto-run only on first scroll into view. |
| respectReducedMotion | boolean | true | Skip animation if user prefers reduced motion. |
| triggerOnHover | boolean | true | Allow re-playing the animation on hover after it completes. |

### Full Component Source
```tsx
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText as GSAPSplitText } from 'gsap/SplitText';
import { useGSAP } from '@gsap/react';
import { JSX } from 'react';

gsap.registerPlugin(ScrollTrigger, GSAPSplitText);

export interface ShuffleProps {
  text: string;
  className?: string;
  style?: React.CSSProperties;
  shuffleDirection?: 'left' | 'right' | 'up' | 'down';
  duration?: number;
  maxDelay?: number;
  ease?: string | ((t: number) => number);
  threshold?: number;
  rootMargin?: string;
  tag?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'span';
  textAlign?: React.CSSProperties['textAlign'];
  onShuffleComplete?: () => void;
  shuffleTimes?: number;
  animationMode?: 'random' | 'evenodd';
  loop?: boolean;
  loopDelay?: number;
  stagger?: number;
  scrambleCharset?: string;
  colorFrom?: string;
  colorTo?: string;
  triggerOnce?: boolean;
  respectReducedMotion?: boolean;
  triggerOnHover?: boolean;
}

const Shuffle: React.FC<ShuffleProps> = ({
  text,
  className = '',
  style = {},
  shuffleDirection = 'right',
  duration = 0.35,
  maxDelay = 0,
  ease = 'power3.out',
  threshold = 0.1,
  rootMargin = '-100px',
  tag = 'p',
  textAlign = 'center',
  onShuffleComplete,
  shuffleTimes = 1,
  animationMode = 'evenodd',
  loop = false,
  loopDelay = 0,
  stagger = 0.03,
  scrambleCharset = '',
  colorFrom,
  colorTo,
  triggerOnce = true,
  respectReducedMotion = true,
  triggerOnHover = true
}) => {
  const ref = useRef<HTMLElement>(null);
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [ready, setReady] = useState(false);

  const splitRef = useRef<GSAPSplitText | null>(null);
  const wrappersRef = useRef<HTMLElement[]>([]);
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const playingRef = useRef(false);
  const hoverHandlerRef = useRef<((e: Event) => void) | null>(null);

  useEffect(() => {
    if ('fonts' in document) {
      if (document.fonts.status === 'loaded') setFontsLoaded(true);
      else document.fonts.ready.then(() => setFontsLoaded(true));
    } else setFontsLoaded(true);
  }, []);

  const scrollTriggerStart = useMemo(() => {
    const startPct = (1 - threshold) * 100;
    const mm = /^(-?\d+(?:\.\d+)?)(px|em|rem|%)?$/.exec(rootMargin || '');
    const mv = mm ? parseFloat(mm[1]) : 0;
    const mu = mm ? mm[2] || 'px' : 'px';
    const sign = mv === 0 ? '' : mv < 0 ? `-=${Math.abs(mv)}${mu}` : `+=${mv}${mu}`;
    return `top ${startPct}%${sign}`;
  }, [threshold, rootMargin]);

  useGSAP(
    () => {
      if (!ref.current || !text || !fontsLoaded) return;
      if (respectReducedMotion && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        onShuffleComplete?.();
        return;
      }

      const el = ref.current as HTMLElement;
      const start = scrollTriggerStart;

      const removeHover = () => {
        if (hoverHandlerRef.current && ref.current) {
          ref.current.removeEventListener('mouseenter', hoverHandlerRef.current);
          hoverHandlerRef.current = null;
        }
      };

      const teardown = () => {
        if (tlRef.current) {
          tlRef.current.kill();
          tlRef.current = null;
        }
        if (wrappersRef.current.length) {
          wrappersRef.current.forEach(wrap => {
            const inner = wrap.firstElementChild as HTMLElement | null;
            const orig = inner?.querySelector('[data-orig="1"]') as HTMLElement | null;
            if (orig && wrap.parentNode) wrap.parentNode.replaceChild(orig, wrap);
          });
          wrappersRef.current = [];
        }
        try {
          splitRef.current?.revert();
        } catch {}
        splitRef.current = null;
        playingRef.current = false;
      };

      const build = () => {
        teardown();

        const computedFont = getComputedStyle(el).fontFamily;

        splitRef.current = new GSAPSplitText(el, {
          type: 'chars',
          charsClass: 'shuffle-char',
          wordsClass: 'shuffle-word',
          linesClass: 'shuffle-line',
          smartWrap: true,
          reduceWhiteSpace: false
        });

        const chars = (splitRef.current.chars || []) as HTMLElement[];
        wrappersRef.current = [];

        const rolls = Math.max(1, Math.floor(shuffleTimes));
        const rand = (set: string) => set.charAt(Math.floor(Math.random() * set.length)) || '';

        chars.forEach(ch => {
          const parent = ch.parentElement;
          if (!parent) return;

          const w = ch.getBoundingClientRect().width;
          const h = ch.getBoundingClientRect().height;
          if (!w) return;

          const wrap = document.createElement('span');
          wrap.className = 'inline-block overflow-hidden text-left';
          Object.assign(wrap.style, {
            width: w + 'px',
            height: shuffleDirection === 'up' || shuffleDirection === 'down' ? h + 'px' : 'auto',
            verticalAlign: 'bottom'
          });

          const inner = document.createElement('span');
          inner.className =
            'inline-block will-change-transform origin-left transform-gpu ' +
            (shuffleDirection === 'up' || shuffleDirection === 'down' ? 'whitespace-normal' : 'whitespace-nowrap');

          parent.insertBefore(wrap, ch);
          wrap.appendChild(inner);

          const firstOrig = ch.cloneNode(true) as HTMLElement;
          firstOrig.className =
            'text-left ' + (shuffleDirection === 'up' || shuffleDirection === 'down' ? 'block' : 'inline-block');
          Object.assign(firstOrig.style, { width: w + 'px', fontFamily: computedFont });

          ch.setAttribute('data-orig', '1');
          ch.className =
            'text-left ' + (shuffleDirection === 'up' || shuffleDirection === 'down' ? 'block' : 'inline-block');
          Object.assign(ch.style, { width: w + 'px', fontFamily: computedFont });

          inner.appendChild(firstOrig);
          for (let k = 0; k < rolls; k++) {
            const c = ch.cloneNode(true) as HTMLElement;
            if (scrambleCharset) c.textContent = rand(scrambleCharset);
            c.className =
              'text-left ' + (shuffleDirection === 'up' || shuffleDirection === 'down' ? 'block' : 'inline-block');
            Object.assign(c.style, { width: w + 'px', fontFamily: computedFont });
            inner.appendChild(c);
          }
          inner.appendChild(ch);

          const steps = rolls + 1;

          if (shuffleDirection === 'right' || shuffleDirection === 'down') {
            const firstCopy = inner.firstElementChild as HTMLElement | null;
            const real = inner.lastElementChild as HTMLElement | null;
            if (real) inner.insertBefore(real, inner.firstChild);
            if (firstCopy) inner.appendChild(firstCopy);
          }

          let startX = 0;
          let finalX = 0;
          let startY = 0;
          let finalY = 0;

          if (shuffleDirection === 'right') {
            startX = -steps * w;
            finalX = 0;
          } else if (shuffleDirection === 'left') {
            startX = 0;
            finalX = -steps * w;
          } else if (shuffleDirection === 'down') {
            startY = -steps * h;
            finalY = 0;
          } else if (shuffleDirection === 'up') {
            startY = 0;
            finalY = -steps * h;
          }

          if (shuffleDirection === 'left' || shuffleDirection === 'right') {
            gsap.set(inner, { x: startX, y: 0, force3D: true });
            inner.setAttribute('data-start-x', String(startX));
            inner.setAttribute('data-final-x', String(finalX));
          } else {
            gsap.set(inner, { x: 0, y: startY, force3D: true });
            inner.setAttribute('data-start-y', String(startY));
            inner.setAttribute('data-final-y', String(finalY));
          }

          if (colorFrom) (inner.style as any).color = colorFrom;
          wrappersRef.current.push(wrap);
        });
      };

      const inners = () => wrappersRef.current.map(w => w.firstElementChild as HTMLElement);

      const randomizeScrambles = () => {
        if (!scrambleCharset) return;
        wrappersRef.current.forEach(w => {
          const strip = w.firstElementChild as HTMLElement;
          if (!strip) return;
          const kids = Array.from(strip.children) as HTMLElement[];
          for (let i = 1; i < kids.length - 1; i++) {
            kids[i].textContent = scrambleCharset.charAt(Math.floor(Math.random() * scrambleCharset.length));
          }
        });
      };

      const cleanupToStill = () => {
        wrappersRef.current.forEach(w => {
          const strip = w.firstElementChild as HTMLElement;
          if (!strip) return;
          const real = strip.querySelector('[data-orig="1"]') as HTMLElement | null;
          if (!real) return;
          strip.replaceChildren(real);
          strip.style.transform = 'none';
          strip.style.willChange = 'auto';
        });
      };

      const play = () => {
        const strips = inners();
        if (!strips.length) return;

        playingRef.current = true;
        const isVertical = shuffleDirection === 'up' || shuffleDirection === 'down';

        const tl = gsap.timeline({
          smoothChildTiming: true,
          repeat: loop ? -1 : 0,
          repeatDelay: loop ? loopDelay : 0,
          onRepeat: () => {
            if (scrambleCharset) randomizeScrambles();
            if (isVertical) {
              gsap.set(strips, { y: (i, t: HTMLElement) => parseFloat(t.getAttribute('data-start-y') || '0') });
            } else {
              gsap.set(strips, { x: (i, t: HTMLElement) => parseFloat(t.getAttribute('data-start-x') || '0') });
            }
            onShuffleComplete?.();
          },
          onComplete: () => {
            playingRef.current = false;
            if (!loop) {
              cleanupToStill();
              if (colorTo) gsap.set(strips, { color: colorTo });
              onShuffleComplete?.();
              armHover();
            }
          }
        });

        const addTween = (targets: HTMLElement[], at: number) => {
          const vars: any = {
            duration,
            ease,
            force3D: true,
            stagger: animationMode === 'evenodd' ? stagger : 0
          };
          if (isVertical) {
            vars.y = (i: number, t: HTMLElement) => parseFloat(t.getAttribute('data-final-y') || '0');
          } else {
            vars.x = (i: number, t: HTMLElement) => parseFloat(t.getAttribute('data-final-x') || '0');
          }

          tl.to(targets, vars, at);

          if (colorFrom && colorTo) tl.to(targets, { color: colorTo, duration, ease }, at);
        };

        if (animationMode === 'evenodd') {
          const odd = strips.filter((_, i) => i % 2 === 1);
          const even = strips.filter((_, i) => i % 2 === 0);
          const oddTotal = duration + Math.max(0, odd.length - 1) * stagger;
          const evenStart = odd.length ? oddTotal * 0.7 : 0;
          if (odd.length) addTween(odd, 0);
          if (even.length) addTween(even, evenStart);
        } else {
          strips.forEach(strip => {
            const d = Math.random() * maxDelay;
            const vars: any = {
              duration,
              ease,
              force3D: true
            };
            if (isVertical) {
              vars.y = parseFloat(strip.getAttribute('data-final-y') || '0');
            } else {
              vars.x = parseFloat(strip.getAttribute('data-final-x') || '0');
            }
            tl.to(strip, vars, d);
            if (colorFrom && colorTo) tl.fromTo(strip, { color: colorFrom }, { color: colorTo, duration, ease }, d);
          });
        }

        tlRef.current = tl;
      };

      const armHover = () => {
        if (!triggerOnHover || !ref.current) return;
        removeHover();
        const handler = () => {
          if (playingRef.current) return;
          build();
          if (scrambleCharset) randomizeScrambles();
          play();
        };
        hoverHandlerRef.current = handler;
        ref.current.addEventListener('mouseenter', handler);
      };

      const create = () => {
        build();
        if (scrambleCharset) randomizeScrambles();
        play();
        armHover();
        setReady(true);
      };

      const st = ScrollTrigger.create({
        trigger: el,
        start,
        once: triggerOnce,
        onEnter: create
      });

      return () => {
        st.kill();
        removeHover();
        teardown();
        setReady(false);
      };
    },
    {
      dependencies: [
        text,
        duration,
        maxDelay,
        ease,
        scrollTriggerStart,
        fontsLoaded,
        shuffleDirection,
        shuffleTimes,
        animationMode,
        loop,
        loopDelay,
        stagger,
        scrambleCharset,
        colorFrom,
        colorTo,
        triggerOnce,
        respectReducedMotion,
        triggerOnHover,
        onShuffleComplete
      ],
      scope: ref
    }
  );

  const baseTw = 'inline-block whitespace-normal break-words will-change-transform uppercase text-2xl leading-none';
  const userHasFont = useMemo(() => className && /font[-[]/i.test(className), [className]);

  const fallbackFont = useMemo(
    () => (userHasFont ? {} : { fontFamily: `'Press Start 2P', sans-serif` }),
    [userHasFont]
  );

  const commonStyle = useMemo(
    () => ({
      textAlign,
      ...fallbackFont,
      ...style
    }),
    [textAlign, fallbackFont, style]
  );

  const classes = useMemo(
    () => `${baseTw} ${ready ? 'visible' : 'invisible'} ${className}`.trim(),
    [baseTw, ready, className]
  );
  const Tag = (tag || 'p') as keyof JSX.IntrinsicElements;

  return React.createElement(Tag, { ref: ref as any, className: classes, style: commonStyle }, text);
};

export default Shuffle;

```

### Integration Instructions
1. Install any listed dependencies.
2. Copy the component source into the appropriate directory in the project.
3. Import and render the component using the usage example above as a starting point.
4. Adjust props as needed for the specific use case — refer to the props table for all available options.
