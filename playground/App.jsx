import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import schema from '../prompts/props.json';
import { REGISTRY, REGISTRY_MAP, MISSING } from './registry.jsx';
import { inferControl } from './inferControl.js';
import PropsPanel from './PropsPanel.jsx';

/** WebGL / gsap 组件参数调坏了会直接抛，别让整页白屏 */
class Boundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error)
      return (
        <div className="pg-crash">
          组件渲染失败（当前参数组合）
          <pre>{String(this.state.error?.message || this.state.error)}</pre>
        </div>
      );
    return this.props.children;
  }
}

/**
 * gsap / WebGL 的错误是在 requestAnimationFrame 回调里抛的，React 的 ErrorBoundary
 * 只管渲染期，抓不到这类错误——结果就是预览区悄悄坏掉却没有任何提示。
 * 这里挂全局监听补上，切组件 / 改参数时自动清空。
 */
function useRuntimeError(resetKey) {
  const [error, setError] = useState(null);
  const keyRef = useRef(resetKey);

  useEffect(() => {
    if (keyRef.current !== resetKey) {
      keyRef.current = resetKey;
      setError(null);
    }
  }, [resetKey]);

  useEffect(() => {
    const onError = e => setError(e.message || String(e.error || e));
    const onRejection = e => setError(String(e.reason?.message || e.reason));
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return [error, () => setError(null)];
}

/**
 * 「交给 AI」—— 选型台存在的意义就是这一下。
 *
 * 人在这里挑效果、调手感（这件事 AI 做不了，得眼睛看）；
 * 调完把「我要这个、参数是这样」连同源码路径、真实依赖、宿主兼容性诊断
 * 一起交回给 LLM，由它按目标项目的技术栈去适配和集成。
 */
function HandoffButton({ name, tunedProps, usage }) {
  const [state, setState] = useState('');

  const handoff = async () => {
    setState('...');
    try {
      const res = await fetch('/api/selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, tunedProps, usage })
      });
      const data = await res.json();
      setState(data.ok ? 'ok' : 'fail');
    } catch {
      setState('fail');
    }
    setTimeout(() => setState(''), 2600);
  };

  return (
    <button className={state === 'ok' ? 'pg-btn pg-btn--ok' : 'pg-btn pg-btn--primary'} onClick={handoff}>
      {state === 'ok' ? '已交给 AI，回对话继续' : state === 'fail' ? '失败' : state === '...' ? '…' : '✦ 交给 AI'}
    </button>
  );
}

/** 只输出与默认值不同的 prop，跟站点 Copy Prompt 的注入逻辑同一个思路 */
function buildUsage(name, values, defaults, controls) {
  const changed = controls
    .filter(c => c.kind !== 'unsupported')
    .filter(c => JSON.stringify(values[c.name]) !== JSON.stringify(defaults[c.name]))
    .map(c => {
      const v = values[c.name];
      if (typeof v === 'string') return `  ${c.name}="${v}"`;
      if (typeof v === 'boolean') return v ? `  ${c.name}` : `  ${c.name}={false}`;
      if (typeof v === 'number') return `  ${c.name}={${v}}`;
      return `  ${c.name}={${JSON.stringify(v)}}`;
    });

  return changed.length ? `<${name}\n${changed.join('\n')}\n/>` : `<${name} />`;
}

function CopyButton({ label, getText }) {
  const [state, setState] = useState('');

  // 内嵌浏览器 / iframe 里 navigator.clipboard 可能不可用，别让它抛未捕获的 rejection
  const copy = async () => {
    try {
      const text = (await getText()) || '';
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      setState('ok');
    } catch {
      setState('fail');
    }
    setTimeout(() => setState(''), 1800);
  };

  return (
    <button className={state === 'ok' ? 'btn btn--ok' : 'btn'} onClick={copy}>
      {state === 'ok' ? '已复制' : state === 'fail' ? '复制失败' : label}
    </button>
  );
}

export default function App() {
  const [selected, setSelected] = useState('Orb');
  const [query, setQuery] = useState('');
  const [overrides, setOverrides] = useState({});

  // 这次选型是给哪个项目做的（由 skill 在启动前写进 .rb-context.json）
  const [hostCtx, setHostCtx] = useState(null);
  const [hostWarnings, setHostWarnings] = useState([]);
  useEffect(() => {
    fetch('/api/context')
      .then(r => r.json())
      .then(setHostCtx)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!hostCtx?.project) return;
    fetch(`/api/host?project=${encodeURIComponent(hostCtx.project)}&component=${selected}`)
      .then(r => r.json())
      .then(d => setHostWarnings(d.warnings || []))
      .catch(() => setHostWarnings([]));
  }, [hostCtx, selected]);

  const meta = useMemo(() => schema.components.find(c => c.name === selected), [selected]);
  const entry = REGISTRY_MAP.get(selected);

  const controls = useMemo(() => {
    if (!meta) return [];
    // propData 里可能有重名条目（Ferrofluid 的 backgroundColor 就登记了两次），
    // 面板按 name 做 key，重名会让 React 报 "two children with the same key"
    const seen = new Set();
    return meta.props
      .filter(p => (seen.has(p.name) ? false : (seen.add(p.name), true)))
      .map(p => ({ ...inferControl(p, meta.previewDefaults), name: p.name, type: p.type }));
  }, [meta]);

  // registry 里的 previewProps 只是为了预览好看（比如给文字组件一个字号），也算默认值，重置回到它
  const defaults = useMemo(
    () => ({ ...Object.fromEntries(controls.map(c => [c.name, c.value])), ...(entry?.previewProps || {}) }),
    [controls, entry]
  );
  const values = useMemo(() => ({ ...defaults, ...(overrides[selected] || {}) }), [defaults, overrides, selected]);

  const setValue = useCallback(
    (name, v) => setOverrides(prev => ({ ...prev, [selected]: { ...(prev[selected] || {}), [name]: v } })),
    [selected]
  );
  const reset = useCallback(() => setOverrides(prev => ({ ...prev, [selected]: {} })), [selected]);

  /**
   * 只传三类值，其余一律不传，让组件用自己源码里的默认值：
   *   ① previewDefaults —— 站点预览区真实在用的配置，一定跑得起来
   *   ② preview-overrides.json 提供的示例数据
   *   ③ 用户这次手动改过的
   *
   * 关键是**不要**把 propData 里的默认值当真值传下去。那是文档，跟实现常有出入
   * （类型写得含糊、值是省略写法、甚至 prop 名都拼错），传下去就是各种
   * "Cannot read properties of null"。不传反而最安全 —— 组件自己的默认值一定是能跑的。
   */
  const liveProps = useMemo(() => {
    const phantom = new Set(meta?.phantomProps || []);
    // registry / preview-overrides 里显式配的东西优先级最高：
    // 它可能是面板根本调不了的类型（Stack 的 cards 是 React.ReactNode[]，
    // 被 inferControl 判成 unsupported），也可能是 propData 里压根没登记的
    // （GridScan 的 modelsPath）。这些都必须传下去，否则组件会用它自己的默认值 ——
    // 而那些默认值往往就是外链图片、CDN 字体。
    const configured = entry?.previewProps || {};
    const trusted = new Set([
      ...Object.keys(meta?.previewDefaults || {}),
      ...Object.keys(configured),
      ...Object.keys(overrides[selected] || {})
    ]);

    const out = { ...configured };
    for (const c of controls) {
      if (phantom.has(c.name)) {
        delete out[c.name];
        continue;
      }
      if (c.kind === 'unsupported' && !(c.name in configured)) continue;
      if (!trusted.has(c.name)) continue;
      if (values[c.name] === undefined) continue;
      out[c.name] = values[c.name];
    }
    return out;
  }, [controls, values, meta, entry, overrides, selected]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = q
      ? REGISTRY.filter(
          r =>
            r.name.toLowerCase().includes(q) ||
            r.category.toLowerCase().includes(q) ||
            (r.dependencies || '').toLowerCase().includes(q) ||
            (q === '无依赖' && !r.dependencies)
        )
      : REGISTRY;
    const groups = {};
    for (const c of hit) (groups[c.category] ||= []).push(c);
    return { groups, count: hit.length };
  }, [query]);

  const frame = entry?.frame || {};

  /**
   * 参数变化怎么反映到组件上，有两条路：
   *   ① 直接把新 props 传下去 —— 组件自己在 useEffect 里响应，画面连续不闪
   *   ② 换 key 整个重挂 —— 对那些只在初始化读一次 props 的组件（WebGL / gsap 居多）才有效
   *
   * 早先只用 ②，结果拖滑块时每一次 onChange 都卸载重建一遍组件：
   * 实测拖一次 Orb 的 hue，206 帧里有 16 帧预览区是空的（canvas 被拆掉了），
   * 看起来就是一直在闪。
   *
   * 现在两条一起走：props 实时传（①），重挂延后到停手 350ms 之后只做一次（②）。
   * 拖动过程中画面连续，松手后再兜底重挂，保证不响应 props 的组件也能更新。
   * 切换组件时 selected 变了，key 立刻变，仍然是立即重挂。
   */
  const propsSignature = JSON.stringify(liveProps);
  const [remountTick, setRemountTick] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setRemountTick(n => n + 1), 350);
    return () => clearTimeout(t);
  }, [propsSignature]);

  const remountKey = `${selected}:${remountTick}`;
  const [runtimeError, clearRuntimeError] = useRuntimeError(remountKey);

  return (
    <div className="pg-app">
      <div className="pg-pane pg-pane--list">
        <div className="pg-pane-head">
          <p className="pg-pane-title">
            组件 · {list.count} / {REGISTRY.length}
            {MISSING.length > 0 && <span style={{ color: '#fda4af' }}> · 缺失 {MISSING.length}</span>}
          </p>
          <input
            className="pg-search"
            placeholder="搜索名称 / 类目 / 依赖…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        <div className="pg-pane-body">
          {Object.entries(list.groups).map(([cat, items]) => (
            <div key={cat}>
              <div className="pg-group-label">
                {cat} <span style={{ opacity: 0.6 }}>{items.length}</span>
              </div>
              {items.map(c => (
                <button
                  key={c.name}
                  className="pg-item"
                  data-name={c.name}
                  aria-selected={c.name === selected}
                  onClick={() => setSelected(c.name)}
                >
                  {c.name}
                  <span className="pg-dep">{c.dependencies || '无依赖'}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="pg-pane">
        <div className="pg-stage-head">
          <span className="pg-stage-name">{selected}</span>
          <span className="pg-stage-meta">
            {meta?.category} · {controls.filter(c => c.kind !== 'unsupported').length}/{controls.length} 个参数可调
          </span>
          <div className="pg-stage-actions">
            <HandoffButton
              name={selected}
              tunedProps={Object.fromEntries(
                Object.entries(values).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(defaults[k]))
              )}
              usage={buildUsage(selected, values, defaults, controls)}
            />
            <CopyButton label="复制用法" getText={() => buildUsage(selected, values, defaults, controls)} />
            <CopyButton label="复制源码" getText={() => entry?.loadSource?.()} />
            <CopyButton label="复制 Prompt" getText={() => entry?.loadPrompt?.()} />
          </div>
        </div>

        {/* 选型时就告诉你这个组件在目标项目里能不能用，别等拷进去才发现 */}
        {hostCtx?.project && hostWarnings.length > 0 && (
          <div className="pg-host-check">
            <b>目标项目 {hostCtx.projectName || hostCtx.project}</b>
            {hostWarnings.map((w, i) => (
              <div key={i} className="pg-host-check__item" data-level={w.level}>
                {w.level === 'error' ? '✗' : w.level === 'warn' ? '⚠' : '·'} {w.message}
              </div>
            ))}
          </div>
        )}

        {runtimeError && (
          <div className="pg-runtime-error">
            <b>预览区运行时报错</b>（不是渲染崩溃，是组件在动画回调里抛的）：{runtimeError}
            <button className="pg-btn" onClick={() => { reset(); clearRuntimeError(); }}>
              恢复默认参数
            </button>
            <button className="pg-btn" onClick={clearRuntimeError}>忽略</button>
          </div>
        )}

        <div className="pg-stage">
          <div
            className="pg-stage-inner"
            style={{
              height: frame.height || 420,
              maxWidth: frame.maxWidth || 900,
              background: frame.background || '#000',
              display: frame.center ? 'flex' : 'block',
              alignItems: frame.center ? 'center' : undefined,
              justifyContent: frame.center ? 'center' : undefined,
              overflow: frame.scroll ? 'auto' : 'hidden'
            }}
          >
            <Boundary resetKey={remountKey}>
              <Suspense fallback={<div className="pg-stage-fallback">加载组件…</div>}>
                {entry && (
                  <entry.Component key={remountKey} {...liveProps}>
                    {entry.children}
                  </entry.Component>
                )}
              </Suspense>
            </Boundary>
          </div>
        </div>
      </div>

      <PropsPanel controls={controls} values={values} defaults={defaults} onChange={setValue} onReset={reset} />
    </div>
  );
}
