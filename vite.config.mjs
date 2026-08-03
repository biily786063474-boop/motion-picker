import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { bridgePlugin } from './playground/vite-bridge.mjs';

// root 就是项目根：这样 playground 能直接 ?raw 引到同级的 components/ 和 prompts/
export default defineConfig({
  plugins: [react(), tailwindcss(), bridgePlugin()],
  // Lanyard import 了 card.glb，vite 默认不把它当二进制资源，构建会报 "not valid UTF-8"
  assetsInclude: ['**/*.glb', '**/*.gltf', '**/*.hdr'],
  server: { port: 5180 },
  build: { outDir: 'playground/dist', emptyOutDir: true }
});
