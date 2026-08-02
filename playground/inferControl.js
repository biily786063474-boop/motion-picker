/**
 * 从 propData（name / type / default / description）推断该用哪个控件、什么范围。
 *
 * 这是整个 playground 成立与否的关键假设：propData 只给了「人看的」类型文字，
 * 没有 min/max/step/枚举。这里靠三层信息去补：
 *   1) type 字段本身（number / boolean / 联合字面量 / ReactNode …）
 *   2) description 里的自然语言（"(0-1)"、'Split type: "chars", "words"…'、"in ms"）
 *   3) 默认值的量级（0.5 → 细粒度小数；400 → 粗粒度整数）
 *
 * 纯 JS ESM，前端和 scripts/audit-controls.mjs 共用，改一处两边同步。
 */

/* ---------- 默认值解析 ---------- */

/** propData.default 是字符串（'0.2' / 'true' / '"chars"' / '{ opacity: 0 }' / 'undefined'） */
export function parseDefaultLiteral(raw) {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  if (s === '' || s === 'undefined' || s === 'null' || s === '—' || s === '-') return undefined;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  const quoted = s.match(/^["'`](.*)["'`]$/s);
  if (quoted) {
    // 文档里的省略写法不是真实值：BlobCursor.filterColorMatrixValues 写作 '1 0 0 ...'，
    // 原样传给 <feColorMatrix values> 会让 SVG 直接报错
    if (/\.\.\.|…/.test(quoted[1])) return undefined;
    return quoted[1];
  }
  if (/^[[{]/.test(s)) {
    try {
      // 上游字面量，来源可控（本地已下载的 MIT 仓库），非用户输入
      return new Function(`return (${s})`)();
    } catch {
      return undefined;
    }
  }
  return s;
}

/** 优先用站点预览区的初始值，其次才是组件默认值 */
export function resolveInitialValue(prop, previewDefaults = {}) {
  if (Object.prototype.hasOwnProperty.call(previewDefaults, prop.name)) return previewDefaults[prop.name];
  return parseDefaultLiteral(prop.default);
}

/* ---------- 从 description / type 里挖信息 ---------- */

// 引号里出现这些说明挖到的是类型名而不是取值，如 `"boolean" | "scroll"`
const TYPE_WORDS = new Set(['boolean', 'string', 'number', 'object', 'array', 'null', 'undefined', 'any', 'function']);

/** 'Split type: "chars", "words", "lines", or "words, chars".' → ['chars','words','lines','words, chars'] */
export function extractEnum(prop) {
  // 去掉 CSSProperties['mixBlendMode'] 这种索引访问里的键名，它不是取值
  const type = String(prop.type || '').replace(/\[\s*["'`][^"'`]*["'`]\s*\]/g, '');
  const fromType = [...type.matchAll(/["'`]([^"'`]+)["'`]/g)].map(m => m[1]).filter(usableOption);
  if (type.includes('|') && fromType.length >= 2) return dedupe(fromType);

  // 枚举总是列在第一句；后面的句子里出现的引号多半是在讲别的 prop
  const desc = String(prop.description || '');
  const firstSentence = desc.split(/(?<=[.。])\s/)[0] || desc;
  // "(e.g. "#ff0000", "#00ff00")" 是举例不是枚举
  const withoutExamples = firstSentence.replace(/\(\s*e\.?\s?g\.?[^)]*\)/gi, '');
  const fromDesc = [...withoutExamples.matchAll(/["'`]([^"'`]{1,24})["'`]/g)].map(m => m[1]).filter(usableOption);
  if (fromDesc.length >= 2) return dedupe(fromDesc);
  return null;
}

function usableOption(v) {
  if (!v) return false;
  if (TYPE_WORDS.has(v.toLowerCase())) return false;
  if (/[.。]/.test(v)) return false;
  if (/^#/.test(v)) return false; // 颜色示例
  if (/^[\d\s.]+$/.test(v)) return false; // "40 80 80" 这类数值示例
  return v.length <= 24;
}

const dedupe = arr => [...new Set(arr)];

/** '(0-1)' / '(0 to 1)' / 'between 0 and 1' → {min,max} */
export function extractRange(description = '') {
  const d = String(description);
  let m =
    d.match(/\(\s*(-?\d+(?:\.\d+)?)\s*(?:-|–|to|~)\s*(-?\d+(?:\.\d+)?)\s*\)/) ||
    d.match(/between\s+(-?\d+(?:\.\d+)?)\s+and\s+(-?\d+(?:\.\d+)?)/i) ||
    d.match(/from\s+(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const min = Number(m[1]);
  const max = Number(m[2]);
  return max > min ? { min, max } : null;
}

/** 'Delay ... (in ms)' → 'ms'，用于滑块右侧显示单位 */
export function extractUnit(prop) {
  const d = String(prop.description || '').toLowerCase();
  if (/\bms\b|millisecond/.test(d)) return 'ms';
  if (/\bin seconds\b|\bseconds\b/.test(d)) return 's';
  if (/degree|deg\b/.test(d)) return '°';
  if (/pixel|\bpx\b/.test(d)) return 'px';
  if (/percent|\bpercentage\b/.test(d)) return '%';
  return '';
}

/** 取色器只吃 hex。名字叫 color 但值是别的格式（如 BorderGlow 的 "40 80 80" HSL 分量）必须走文本框，
 *  否则取色器解析不了会直接崩。 */
const HEX = /^#[0-9a-f]{3,8}$/i;
function isColorish(name, value) {
  if (typeof value === 'string') return HEX.test(value.trim());
  if (value == null) return /colou?r$|^colou?r/i.test(name);
  return false;
}

/* ---------- 数值范围推断 ---------- */

/** 驼峰 / 下划线拆词：'sparkRadius' → ['spark','radius']，'duration' → ['duration'] */
function tokenize(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * 按名字划一档「量纲」，比只看默认值靠谱得多。
 *
 * 必须整词匹配，不能用子串——'duration' 里含 'ratio'（du-ratio-n），
 * 子串匹配会把它判成 0-1 的比例，而它的默认值是 400ms，滑块直接容不下当前值。
 *
 * minPositive: 该量纲取 0 等于「效果消失」（0 个粒子、0 时长、0 尺寸），
 * 最小值给一个 step 而不是 0，免得拖到最左边看起来像坏了。
 */
const NUMERIC_HINTS = [
  { re: /^(hue|hueshift)$/, min: 0, max: 360, step: 1, unit: '°' },
  { re: /^(opacity|alpha|fade|transparency)$/, min: 0, max: 1, step: 0.01 },
  { re: /^(threshold|progress|ratio|percent|percentage|fraction)$/, min: 0, max: 1, step: 0.01 },
  { re: /^(rotation|rotate|angle|tilt|deg|degrees|skew)$/, min: -180, max: 180, step: 1, unit: '°' },
  {
    re: /^(count|amount|quantity|particles|segments|columns|cols|rows|items|steps|repeat|repeats|copies|lines|num|number|total)$/,
    integer: true,
    minPositive: true
  },
  // 延迟为 0 是合法且常用的
  { re: /^(delay|stagger|throttle|debounce|offsetdelay)$/, time: true },
  // 时长为 0 意味着动画瞬间结束，等于没效果
  { re: /^(duration|speed|interval|transition|time|timeout|lifetime)$/, time: true, minPositive: true },
  // 尺寸为 0 就看不见了
  { re: /^(radius|size|width|height|thickness|length|diameter)$/, px: true, minPositive: true },
  // 这些取 0 是合法的（无偏移、无间距、无模糊）
  { re: /^(blur|spread|distance|offset|padding|gap|margin|spacing|depth|inset|top|left|right|bottom)$/, px: true },
  {
    re: /^(scale|intensity|strength|factor|force|density|amplitude|frequency|weight|friction|damping|stiffness|chaos|curve|power)$/,
    unitless: true
  }
];

const matchHint = name => {
  const tokens = tokenize(name);
  return NUMERIC_HINTS.find(h => tokens.some(t => h.re.test(t)));
};

/** 把「最大值」收敛到人看着舒服的刻度：1.5 → 2，320 → 500 */
function niceMax(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

function stepFor(min, max) {
  const span = max - min;
  if (span <= 2) return 0.01;
  if (span <= 20) return 0.1;
  if (span <= 200) return 1;
  return Math.max(1, Math.round(span / 200));
}

/**
 * 兜底防线：无论上面哪条规则推出来的范围，都必须容得下当前值。
 * 容不下的话滑块一拖就会把值毁掉（duration=400 掉进 [0,1] 就成了 0.5ms，动画等于没有）。
 */
function ensureCovers(range, d) {
  if (!Number.isFinite(d)) return range;
  if (d > range.max) {
    range.max = niceMax(d * 2);
    range.step = stepFor(range.min, range.max);
    range.widened = true;
  }
  if (d < range.min) {
    range.min = d < 0 ? -niceMax(Math.abs(d) * 2) : 0;
    range.step = stepFor(range.min, range.max);
    range.widened = true;
  }
  return range;
}

export function inferNumberRange(prop, value) {
  const d = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const unit = extractUnit(prop);

  // ① description 里写了范围，最可信
  const explicit = extractRange(prop.description);
  if (explicit)
    return ensureCovers({ ...explicit, step: stepFor(explicit.min, explicit.max), unit, basis: 'description' }, d);

  // ② 名字整词命中量纲表
  const h = matchHint(prop.name);
  if (h) {
    if (h.min !== undefined)
      return ensureCovers({ min: h.min, max: h.max, step: h.step, unit: unit || h.unit || '', basis: 'name' }, d);

    if (h.integer) {
      const max = Math.max(niceMax(d * 4), 10);
      return ensureCovers({ min: h.minPositive ? 1 : 0, max, step: 1, unit, basis: 'name' }, d);
    }
    if (h.time) {
      const max = Math.max(niceMax(d * 4), unit === 'ms' ? 1000 : 2);
      const step = unit === 'ms' ? Math.max(1, Math.round(max / 200)) : stepFor(0, max);
      return ensureCovers({ min: h.minPositive ? step : 0, max, step, unit, basis: 'name' }, d);
    }
    if (h.px) {
      const max = Math.max(niceMax(d * 4), 50);
      const step = stepFor(0, max);
      return ensureCovers({ min: h.minPositive ? step : 0, max, step, unit, basis: 'name' }, d);
    }
    if (h.unitless) {
      const max = Math.max(niceMax(d * 4), 2);
      const step = stepFor(0, max);
      return ensureCovers({ min: 0, max, step, unit, basis: 'name' }, d);
    }
  }

  // ③ 只能按默认值的量级兜底
  if (d === 0) return { min: 0, max: 1, step: 0.01, unit, basis: 'fallback' };
  if (d < 0) {
    const bound = niceMax(Math.abs(d) * 3);
    return { min: -bound, max: bound, step: stepFor(-bound, bound), unit, basis: 'fallback' };
  }
  const max = Math.max(niceMax(d * 4), Number.isInteger(d) ? 10 : 1);
  return ensureCovers({ min: 0, max, step: stepFor(0, max), unit, basis: 'fallback' }, d);
}

/* ---------- 主入口 ---------- */

/**
 * @returns {{kind:'slider'|'switch'|'color'|'select'|'text'|'json'|'unsupported',
 *            value:any, reason?:string, min?:number, max?:number, step?:number,
 *            unit?:string, options?:string[], basis?:string}}
 */
export function inferControl(prop, previewDefaults = {}) {
  const type = String(prop.type || '').trim();
  const value = resolveInitialValue(prop, previewDefaults);
  const lower = type.toLowerCase();

  if (/react\.?node|reactnode|reactelement|jsx|children|component/i.test(type) || prop.name === 'children')
    return { kind: 'unsupported', value, reason: 'ReactNode，由预览容器提供内容' };

  if (/function|=>|\(\)|callback|handler/i.test(lower) || /^on[A-Z]/.test(prop.name))
    return { kind: 'unsupported', value, reason: '回调函数，不可视化调节' };

  // 数组/对象要在枚举之前判掉：`string[] | null` 的描述里常带颜色示例，会被误当成枚举
  if (/\[\]|^array|^object\b|^record|^\{|^\[/.test(lower))
    return { kind: 'json', value, reason: '对象/数组，用 JSON 编辑' };

  if (lower === 'boolean' || lower === 'bool') return { kind: 'switch', value: Boolean(value) };

  const options = extractEnum(prop);
  if (options && (lower.includes('|') || lower === 'string')) return { kind: 'select', value, options };

  // 类型文字不可靠时以实际值为准：`"boolean" | "scroll"` 的默认值是 false，
  // 当成文本会把 false 变成字符串 "false" 传进组件，那是真会出错的
  if (typeof value === 'boolean') return { kind: 'switch', value };

  if (lower === 'number' || lower === 'int' || lower === 'float')
    return { kind: 'slider', value: typeof value === 'number' ? value : 0, ...inferNumberRange(prop, value) };

  if (lower === 'string' || lower === 'string | number') {
    if (isColorish(prop.name, value)) return { kind: 'color', value: typeof value === 'string' ? value : '#ffffff' };
    return { kind: 'text', value: value == null ? '' : String(value) };
  }

  // 类型文字没见过：能认出值的类型就退化处理，认不出就标不支持
  if (typeof value === 'number') return { kind: 'slider', value, ...inferNumberRange(prop, value) };
  if (typeof value === 'boolean') return { kind: 'switch', value };
  if (typeof value === 'string')
    return isColorish(prop.name, value) ? { kind: 'color', value } : { kind: 'text', value };
  return { kind: 'unsupported', value, reason: `无法识别的类型：${type}` };
}
