import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: './src/main.ts',
      name: 'seren-worker',
      fileName: 'seren-worker',
      formats: ['es', 'umd']
    }
  },
});