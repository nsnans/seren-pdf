import { defineConfig } from 'vite';
import path from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, './src/index.ts'),
      name: 'seren-viewer',
      fileName: 'seren-viewer',
      formats: ['es', 'umd']
    }
  },
});