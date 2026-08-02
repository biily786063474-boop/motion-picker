/**
 * 参数面板：完全由 inferControl 的推断结果驱动，没有一行是为某个具体组件写的。
 * 这就是整个方案的关键——139 个组件共用这一个面板，而不是像上游那样每个 demo 手写一遍。
 */
import { useState } from 'react';
import PreviewSlider from './controls/PreviewSlider';
import PreviewSwitch from './controls/PreviewSwitch';
import PreviewInput from './controls/PreviewInput';
import PreviewSelect from './controls/PreviewSelect';
import PreviewColorPickerCustom from './controls/PreviewColorPickerCustom';

/** 取色器只认 6 位 hex；带 alpha 的（#ffffff40）先摘掉后缀，改完再拼回去，免得静默丢掉透明度 */
function splitAlpha(hex) {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(String(hex).trim());
  return m ? { base: `#${m[1]}`, alpha: m[2] } : { base: String(hex), alpha: '' };
}

const shapeOf = v => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

function JsonField({ title, value, defaultValue, onChange }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? null));
  const [problem, setProblem] = useState('');
  const expected = shapeOf(defaultValue);

  const handle = next => {
    setText(next);
    let parsed;
    try {
      parsed = JSON.parse(next);
    } catch {
      setProblem('不是合法 JSON');
      return;
    }
    // 类型必须跟默认值一致：给 gsap 的 from 传个字符串或数组，它会在 rAF 里抛错，
    // 那种错误 React 的 ErrorBoundary 抓不到，界面会直接坏掉且没有提示
    if (expected !== 'undefined' && expected !== 'null' && shapeOf(parsed) !== expected) {
      setProblem(`类型要保持 ${expected}，当前是 ${shapeOf(parsed)}`);
      return;
    }
    setProblem('');
    onChange(parsed);
  };

  return (
    <div className="pg-prop-row">
      <div className="pg-json-label">{title}</div>
      <textarea className="pg-json-edit" data-invalid={Boolean(problem)} value={text} onChange={e => handle(e.target.value)} />
      {problem && <div className="pg-basis-tag" data-basis="fallback">{problem}，未生效</div>}
    </div>
  );
}

export default function PropsPanel({ controls, values, defaults, onChange, onReset }) {
  const editable = controls.filter(c => c.kind !== 'unsupported');
  const locked = controls.filter(c => c.kind === 'unsupported');

  return (
    <div className="pg-pane pg-pane--props">
      <div className="pg-pane-head">
        <p className="pg-pane-title">参数 · {editable.length} 可调 / {controls.length} 总计</p>
        <button className="pg-btn" onClick={onReset} style={{ width: '100%' }}>
          重置为默认值
        </button>
      </div>

      <div className="pg-pane-body">
        {editable.map(c => {
          const value = values[c.name];
          const set = v => onChange(c.name, v);

          if (c.kind === 'slider')
            return (
              <div className="pg-prop-row" key={c.name}>
                <PreviewSlider
                  title={c.name}
                  min={c.min}
                  max={c.max}
                  step={c.step}
                  value={typeof value === 'number' ? value : 0}
                  valueUnit={c.unit || ''}
                  onChange={set}
                />
                {/* 只有「猜」出来的范围才提示，其余两种依据够可靠，不必占版面 */}
                {c.basis === 'fallback' && (
                  <div className="pg-basis-tag" data-basis="fallback">
                    范围是按默认值猜的（{c.min}–{c.max}），可能不合适
                  </div>
                )}
              </div>
            );

          if (c.kind === 'switch')
            return (
              <div className="pg-prop-row" key={c.name}>
                <PreviewSwitch title={c.name} isChecked={Boolean(value)} onChange={set} />
              </div>
            );

          if (c.kind === 'select')
            return (
              <div className="pg-prop-row" key={c.name}>
                <PreviewSelect
                  title={c.name}
                  value={String(value ?? '')}
                  options={c.options.map(o => ({ value: o, label: o }))}
                  onChange={set}
                />
              </div>
            );

          if (c.kind === 'color') {
            const { base, alpha } = splitAlpha(value ?? '#ffffff');
            return (
              <div className="pg-prop-row" key={c.name}>
                <PreviewColorPickerCustom title={c.name} color={base} onChange={v => set(alpha ? `${v}${alpha}` : v)} />
                {alpha && <div className="pg-basis-tag">透明度后缀 {alpha} 保持不变（取色器只调 RGB）</div>}
              </div>
            );
          }

          if (c.kind === 'json')
            return (
              <JsonField key={c.name} title={c.name} value={value} defaultValue={defaults?.[c.name]} onChange={set} />
            );

          return (
            <div className="pg-prop-row" key={c.name}>
              <PreviewInput title={c.name} value={value == null ? '' : String(value)} onChange={set} />
            </div>
          );
        })}

        {locked.length > 0 && (
          <div className="pg-unsupported-list">
            <div className="pg-pane-title" style={{ padding: '0 4px 4px' }}>不可视化调节</div>
            {locked.map(c => (
              <div className="pg-unsupported-item" key={c.name}>
                <b>{c.name}</b> — {c.reason}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
