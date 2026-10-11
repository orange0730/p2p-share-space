import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // GitHub Pages 部署在 /<repo>/ 底下，由 CI 傳入 BASE_PATH
  base: process.env.BASE_PATH || '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 不自動更新：Host 頁面被自動重新整理會讓空間解散；新版在所有分頁關閉後才生效
      registerType: 'prompt',
      injectRegister: 'script',
      // 自訂 Service Worker（src/sw.js）：除了預快取，還要接收系統分享選單的 POST
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'logo.svg'],
      manifest: {
        name: 'P2P 共享空間',
        short_name: '共享空間',
        description: '純前端、點對點的跨裝置共享空間',
        lang: 'zh-Hant',
        theme_color: '#4f46e5',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Android：在相簿或任何 App 按「分享」就能選「共享空間」（iOS Safari 尚不支援）
        share_target: {
          action: 'share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [{ name: 'files', accept: ['*/*'] }],
          },
        },
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
    }),
  ],
  // 對區網開放，手機才能用 http://<電腦 IP>:5173 掃碼加入
  server: { host: true },
  preview: { host: true },
});
