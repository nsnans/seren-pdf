import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: './src/index.ts',
      name: 'seren-core',
      fileName: 'seren-core',
      formats: ['es', 'umd']
    }
  },
});