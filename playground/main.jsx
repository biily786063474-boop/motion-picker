import { createRoot } from 'react-dom/client';

import './css/app.css'; // 含 tailwind，必须最先
import './css/variables.css';
import './css/preview-slider.css';

import { useGLTF } from '@react-three/drei';

import App from './App.jsx';

/**
 * drei 的 useGLTF 默认从 gstatic 拉 Draco 解码器（FluidGlass 这类加载 .glb 的组件会触发）。
 * 离线时那两个请求会挂住，模型加载不出来。解码器 three 包里就带着，拷到了 public/draco/。
 */
useGLTF.setDecoderPath('/draco/');

/**
 * 这里刻意不套 StrictMode。
 *
 * StrictMode 在开发模式下会把每个 effect 挂载两次（挂→卸→再挂），对普通组件是好事，
 * 但这里预览的是 139 个第三方 WebGL / gsap 组件：它们在 effect 里创建 WebGL context、
 * 启动 rAF 循环、注册全局监听，双挂载会造成 context 泄漏和异步竞态 ——
 * 表现就是 Hyperspeed 报 "Cannot read properties of null (reading 'alpha')"、
 * Ballpit 报 "null.precision"（context 被浏览器回收后 renderer 还在用）。
 *
 * 这些组件的代码不归我们管，也不打算改它们，所以关掉双挂载。
 */
createRoot(document.getElementById('root')).render(<App />);
