import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: './src/index.ts',
      name: 'seren-viewer',
      fileName: 'seren-viewer',
      formats: ['es', 'umd']
    }
  },
});