import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

export default defineConfig(() => {
  const version = JSON.parse(readFileSync(new URL('./version.json', import.meta.url), 'utf8')) as {
    major: number;
    minor: number;
    patch: number;
    build: number;
  };

  return {
    define: {
      __WORKSHOP_VERSION__: JSON.stringify(
        `v${version.major}.${version.minor}.${version.patch} (build ${version.build})`,
      ),
    },
    plugins: [react(), tailwindcss()],
    server: {
      host: true,
      port: 5180,
      proxy: {
        '/api': {
          target: 'http://localhost:3006',
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
