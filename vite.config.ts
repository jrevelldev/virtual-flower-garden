import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Relative base for GitHub Pages and subpath hosting
  server: {
    port: 3000,
    host: true, // Allow local network access for testing with real mobile phone on same Wi-Fi!
  },
  preview: {
    port: 3000,
    host: true,
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
});

