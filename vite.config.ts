import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the site from /frontier-planner/.
  base: '/frontier-planner/',
  server: { port: 5173 },
  test: { environment: 'node' },
} as any);
