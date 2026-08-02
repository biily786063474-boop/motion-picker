/**
 * 检测「调参时画面闪烁」：逐帧采样预览区，统计有多少帧组件被卸载成空。
 * 参数变化如果触发完整重挂，拖滑块时就会反复卸载重建 —— 表现为闪烁。
 * 正常应该只有 0~1 帧（停手后的那次兜底重挂）。
 */
import { chromium } from 'playwright';

const NAME = process.argv[2] || 'Orb';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:5180', { waitUntil: 'networkidle' });
await page.locator(`.pg-item[data-name="${NAME}"]`).first().click();
await page.waitForTimeout(2500);

// 逐帧记录：预览区子节点数、是否出现 Suspense fallback、背景色、以及一个采样点的实际颜色
await page.evaluate(() => {
  window.__frames = [];
  const probe = () => {
    const inner = document.querySelector('.pg-stage-inner');
    if (inner) {
      const cs = getComputedStyle(inner);
      const r = inner.getBoundingClientRect();
      const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      window.__frames.push({
        t: performance.now(),
        kids: inner.childElementCount,
        deep: inner.querySelectorAll('*').length,
        bg: cs.backgroundColor,
        fallback: !!inner.querySelector('.pg-stage-fallback'),
        crash: !!inner.querySelector('.pg-crash'),
        midTag: mid ? mid.tagName : null,
        midBg: mid ? getComputedStyle(mid).backgroundColor : null
      });
    }
    window.__raf = requestAnimationFrame(probe);
  };
  probe();
});

const s = page.locator('[role="slider"]').first();
const label = await s.getAttribute('aria-label');
const box = await s.boundingBox();
await page.mouse.move(box.x + 4, box.y + box.height / 2);
await page.mouse.down();
for (let i = 1; i <= 20; i++) {
  await page.mouse.move(box.x + (box.width - 8) * (i / 20), box.y + box.height / 2);
  await page.waitForTimeout(30);
}
await page.mouse.up();
await page.waitForTimeout(800);

const frames = await page.evaluate(() => {
  cancelAnimationFrame(window.__raf);
  return window.__frames;
});

console.log(`${NAME} 拖动 ${label}，共采样 ${frames.length} 帧`);
const empty = frames.filter(f => f.deep <= 1);
const fb = frames.filter(f => f.fallback);
const bgs = [...new Set(frames.map(f => f.bg))];
const midBgs = [...new Set(frames.map(f => `${f.midTag}:${f.midBg}`))];
console.log(`  预览区几乎空（子孙 ≤1）的帧：${empty.length}`);
console.log(`  出现 Suspense「加载组件…」的帧：${fb.length}`);
console.log(`  容器背景色取值：${bgs.join(' | ')}`);
console.log(`  中心点元素/背景：${midBgs.slice(0, 6).join('  ')}`);
const deeps = frames.map(f => f.deep);
console.log(`  子孙节点数区间：${Math.min(...deeps)} ~ ${Math.max(...deeps)}`);
await browser.close();
