import { defineConfig } from 'vite';
import path from 'path'
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [{ src: 'node_modules/seren-viewer/l10n/', dest: './' }]
    })
  ],
  build: {
    lib: {
      entry: path.resolve(__dirname, './src/index.ts'),
      name: 'seren-web',
      fileName: 'seren-web',
      formats: ['es', 'umd']
    }
  },
});