import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { pwaBuild } from './pwa-build.js';
import { createBuildId } from './build-id.js';

// Where the dev server forwards /api, /uploads and the socket.
//
// Configurable so a second client can be pointed at a second API — running one
// branch's server on another port while the usual one keeps its place is
// otherwise impossible without editing this file. Defaults to the standard
// dev port, so nothing changes unless you ask for it.
//
//   VITE_API_TARGET=http://localhost:3002 npm run dev:client
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:3001';

const proxy = (extra = {}) => ({ target: apiTarget, changeOrigin: true, ...extra });

// Shared by the page and emitted worker; see pwa-build.js.
export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const buildId = process.env.BUILD_ID || createBuildId(root, { mode, ...loadEnv(mode, root, 'VITE_') });
  return {
    plugins: [react(), pwaBuild(buildId)],
    define: {
      __BUILD_ID__: JSON.stringify(buildId),
    },
    // `vite preview` serves the BUILT bundle, which is the only place the
    // offline shell can be checked honestly (the dev server has no hashed
    // assets to cache). Same proxy as dev so /api reaches the same server.
    preview: {
      port: Number(process.env.VITE_PREVIEW_PORT) || 4174,
      proxy: {
        '/api': proxy(),
        '/uploads': proxy(),
        '/socket.io': proxy({ ws: true }),
        '/favicon.ico': proxy(),
        '/apple-touch-icon.png': proxy(),
        '/apple-touch-icon-precomposed.png': proxy(),
        '/manifest.json': proxy(),
        '/robots.txt': proxy(),
        '/sitemap.xml': proxy(),
      },
    },
    server: {
      port: Number(process.env.VITE_PORT) || 5173,
      proxy: {
        '/api': proxy(),
        '/uploads': proxy(),
        '/socket.io': proxy({ ws: true }),
        // The store's identity files. These live in `public/` as shipped
        // defaults, and the server overrides them from the operator's uploaded
        // app icon (server/routes/appIcons.js) — so left unproxied, dev would
        // serve the CryptoStore mark while production served the store's own,
        // which is the sort of divergence you discover after deploying.
        //
        // Exact paths, not a prefix: `/icon-192.png` and the rest stay with Vite
        // because the server never rewrites those, and proxying them would put a
        // hop in front of a static file for no reason.
        '/favicon.ico': proxy(),
        '/apple-touch-icon.png': proxy(),
        '/apple-touch-icon-precomposed.png': proxy(),
        '/manifest.json': proxy(),
        // Same family: computed from settings by the server, so the dev
        // client shows what the deployed one will say (server/services/seo.js).
        '/robots.txt': proxy(),
        '/sitemap.xml': proxy(),
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});
