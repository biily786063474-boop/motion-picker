/**
 * 语义检索：把「想要个暗色流动的背景」这种话，变成一个组件排序。
 *
 * 不用向量、不用嵌入模型 —— 140 条语义卡片全加起来才十几 KB，
 * 真正的语义匹配应该交给读得到全表的 LLM。这里的打分是给
 * 「不方便调 LLM 的场合」用的：命令行快速筛、程序化调用、
 * 以及给 LLM 先缩小候选范围。
 */

/**
 * 需求描述里可能出现的说法 → 结构化约束
 *
 * 词要挑得够具体。踩过两个坑：
 *   - cursor 里放裸的「鼠标」，「鼠标移上去发光」就被判成光标特效 —— 几乎所有交互都会提鼠标
 *   - text 里放单字「字」，「数字递增」也会中
 */
const SURFACE_HINTS = {
  'fullscreen-bg': ['背景', '底纹', '打底', '全屏', '底图', 'hero', '首屏', '大背景', '衬底'],
  text: ['文字', '标题', '文案', '标语', '排版', 'title', '正文', '字体'],
  wrapper: ['包裹', '卡片上', '内容上', '容器', '加在', '套在'],
  cursor: ['光标', '指针', '跟随鼠标', '鼠标跟随', '鼠标特效', '自定义光标', '拖尾'],
  collection: ['列表', '画廊', '轮播', '多张', '一组', '图集', '网格排列', '瀑布流'],
  element: ['按钮', '单个元素', '小元件']
};

const TRIGGER_HINTS = {
  hover: ['悬停', '移上去', '鼠标经过', 'hover', '划过'],
  click: ['点击', '点一下', '按下', 'click', '点按'],
  scroll: ['滚动', '滚到', '下滑', 'scroll', '进入视口'],
  ambient: ['一直', '常驻', '自动', '循环', '持续']
};

const WEIGHT_HINTS = {
  light: ['轻', '轻量', '性能', '不卡', '省电', '低配', '简单'],
  heavy: ['炫', '震撼', '3d', '立体', '粒子']
};

const INTENSITY_HINTS = {
  subtle: ['低调', '克制', '别太', '不要太', '安静', '淡', '轻微', '不抢'],
  bold: ['炫', '震撼', '抓眼', '冲击', '夸张', '强烈', '醒目', '吸睛']
};

const norm = s => String(s || '').toLowerCase().replace(/[\s，,。、！!？?的了]/g, '');

/** 需求里提到某组词的任意一个就算命中 */
const mentions = (q, words) => words.some(w => q.includes(norm(w)));

/** 中文没有空格，切 2-gram 当分词用 */
function bigrams(s) {
  const out = new Set();
  if (s.length < 2) {
    if (s) out.add(s);
    return out;
  }
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/**
 * 关键词与需求的贴合度 0~1。
 *
 * 纯子串判断不够用：「数字动画」明明贴合「数字递增动画」，但后者不包含前者这个连续串，
 * 整条就一分不得，最后全靠 surface 那 12 分同分，排序退化成字母序。
 *
 * 所以按 2-gram 双向算重叠：
 *   a —— 关键词的片段有多少出现在需求里（需求比关键词长时靠这个）
 *   b —— 需求的片段有多少出现在关键词里（用户只说「发光」、关键词是「悬停发光」时靠这个）
 */
function relevance(keyword, q, qGrams) {
  const k = norm(keyword);
  if (!k) return 0;
  if (q.includes(k)) return 1; // 完整命中
  if (k.length < 2 || !qGrams.size) return 0; // 单字不做部分匹配，噪音太大

  const kb = bigrams(k);
  let a = 0;
  for (const g of kb) if (q.includes(g)) a++;
  let b = 0;
  for (const g of qGrams) if (k.includes(g)) b++;
  return Math.max(a / kb.size, b / qGrams.size);
}

/* 试过、又退掉的一条规则：把复合词尾部 2 字（「悬停发光」→「发光」）也算命中。
 * 它确实让「鼠标移上去发光」排出了 BorderGlow，但尾词恰恰是最宽泛的类别词
 * （文字 / 标题 / 背景），共享同一尾词的组件会一起加分，精确查询立刻被淹掉：
 * 「标题逐字浮现」里 GlitchText 靠「撕裂标题」「潮流标题」「抖动标题」叠了 18 分，
 * 直接把 SplitText 顶出前四。修一个模糊查询、坏三个精确查询，不划算。 */

/** 低于这个贴合度就不算命中 —— 再低就是噪音了 */
const HIT = 0.5;

/**
 * @param {string} query   自然语言需求
 * @param {Array}  items   semantic.json 的 components
 * @param {object} opts    { limit, excludeDeps, maxWeight }
 */
export function search(query, items, opts = {}) {
  const { limit = 10, excludeDeps = [], lightOnly = false } = opts;
  const q = norm(query);
  if (!q) return [];
  const qGrams = bigrams(q);

  // 从需求里解析出硬约束。
  // surface 取「命中词最长」的那个，不是第一个匹配的 —— 否则结果取决于上面表的书写顺序，
  //「图片画廊轮播」既中 collection 的「画廊」也中 element，谁在前谁赢就成了玄学。
  let wantSurface = null;
  let surfaceHintLen = 0;
  for (const [key, words] of Object.entries(SURFACE_HINTS))
    for (const w of words) {
      const n = norm(w);
      if (n.length > surfaceHintLen && q.includes(n)) {
        wantSurface = key;
        surfaceHintLen = n.length;
      }
    }
  const wantTriggers = Object.entries(TRIGGER_HINTS).filter(([, ws]) => mentions(q, ws)).map(([k]) => k);
  const wantLight = lightOnly || mentions(q, WEIGHT_HINTS.light);
  const wantIntensity = Object.entries(INTENSITY_HINTS).find(([, ws]) => mentions(q, ws))?.[0];

  const scored = [];
  for (const c of items) {
    if (excludeDeps.length && c.deps?.some(d => excludeDeps.includes(d))) continue;
    if (wantLight && c.heavy) continue;

    let score = 0;
    const why = [];

    /** 按贴合度给分，完整命中拿满分，部分贴合按比例 */
    const hit = (text, weight) => {
      const r = relevance(text, q, qGrams);
      if (r < HIT) return;
      score += weight * r;
      why.push(text);
    };

    // 中文关键词命中最值钱 —— 那是专门为「用户会怎么描述」写的
    for (const k of c.zh || []) hit(k, 10);
    // 摘要里的词
    for (const seg of String(c.summary || '').split(/[，,、。；;\s]/)) if (seg.length >= 2) hit(seg, 6);
    // 气质 / 场景 / 运动 / 色调
    for (const m of c.mood || []) hit(m, 8);
    for (const s of c.scenes || []) hit(s, 7);
    if (c.motion) hit(c.motion, 8);
    for (const p of c.palette || []) hit(p, 5);

    // 英文兜底（没标注时靠这个，权重低）
    for (const k of c.en || []) if (k.length > 3 && q.includes(k)) score += 2;

    // 组件名直接命中
    if (q.includes(norm(c.name))) score += 20;

    // 结构约束：对上加分，不对扣分（不是硬过滤，避免误判把正确答案筛掉）
    if (wantSurface) score += c.surface === wantSurface ? 12 : -6;
    for (const t of wantTriggers) score += c.triggers?.includes(t) ? 6 : -2;
    if (wantIntensity && c.intensity) score += c.intensity === wantIntensity ? 6 : -3;

    if (score > 0) scored.push({ ...c, score, matched: [...new Set(why)].slice(0, 6) });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** 给 LLM 读的精简全表 —— 140 条压到十几 KB，可以整个塞进上下文自己做语义匹配 */
export function catalog(items) {
  return items.map(c => ({
    name: c.name,
    cat: c.category,
    what: c.summary || '(未标注)',
    surface: c.surface,
    trigger: c.triggers?.join('/'),
    mood: c.mood?.join('/') || '',
    scenes: c.scenes?.join('/') || '',
    intensity: c.intensity || '',
    heavy: c.heavy || undefined,
    deps: c.deps?.length ? c.deps.join(' ') : undefined,
    // 只有踩过才知道的坑 —— 匹配时先看这条，能省掉一轮返工
    avoid: c.avoid || undefined
  }));
}
