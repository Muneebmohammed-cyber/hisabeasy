import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'config.js'],
      manifest: {
        name: 'HisabEasy – Small Business Assistant',
        short_name: 'HisabEasy',
        description: 'Your Business. Your Hisab. One Easy App.',
        theme_color: '#0B6E4F',
        background_color: '#F7F8F5',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['**/config.js', '**/pglite*', '**/initdb*'],
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          { urlPattern: /config\.js$/, handler: 'NetworkFirst' },
          // Demo engine (~15 MB) is fetched only when someone opens the demo, then kept for offline use.
          { urlPattern: /\/(pglite|initdb)[^/]*\.(wasm|data|js)$/, handler: 'CacheFirst', options: { cacheName: 'demo-engine', expiration: { maxEntries: 10 } } },
          { urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//, handler: 'StaleWhileRevalidate', options: { cacheName: 'fonts' } },
        ],
      },
    }),
  ],
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  worker: { format: 'es' },
});
