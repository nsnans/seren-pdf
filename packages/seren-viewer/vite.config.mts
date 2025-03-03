import path from 'path';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [{ src: 'l10n/', dest: './' }]
    })
  ],
  build: {
    lib: {
      entry: path.resolve(__dirname, './src/index.ts'),
      name: 'seren-viewer',
      fileName: 'seren-viewer',
      formats: ['es', 'umd']
    }
  },
});