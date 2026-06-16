import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const tsconfigRaw = {
  compilerOptions: {
    target: 'ES2020',
    lib: ['ES2020', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    moduleResolution: 'Bundler',
    jsx: 'react-jsx',
    strict: true,
    skipLibCheck: true,
    isolatedModules: true,
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  esbuild: { tsconfigRaw },
  optimizeDeps: {
    esbuildOptions: { tsconfigRaw },
  },
});
