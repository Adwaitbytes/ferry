import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { buildManifest, resolveOrigins } from './manifest.config';

const origins = resolveOrigins(process.env);

export default defineConfig({
  srcDir: 'src',
  publicDir: 'public',
  modules: ['@wxt-dev/module-react'],
  // Explicit imports only: auto-imports hide where browser APIs are touched, which matters for review.
  imports: false,
  manifestVersion: 3,
  manifest: buildManifest(origins),
  zip: { artifactTemplate: 'ferry-extension-{{version}}-{{browser}}.zip' },
  vite: () => ({
    plugins: [tailwindcss()],
    define: {
      __FERRY_API_ORIGIN__: JSON.stringify(origins.api),
      __FERRY_WEB_ORIGINS__: JSON.stringify(origins.web),
    },
    build: { sourcemap: false },
  }),
});
