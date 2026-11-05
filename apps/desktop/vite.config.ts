/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// The version line at the foot of Settings (src/version.ts): package.json's version and the build day (local time).
const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const now = new Date();
const buildDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

// Tauri expects a fixed dev port and keeps its own console output visible.
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version), __BUILD_DATE__: JSON.stringify(buildDay) },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  // Task 7 review m1 -> Task 9: jsPDF's own `.html()` / `.addSvgAsImage()` paths carry `import('html2canvas')`,
  // `import('dompurify')` and `import('canvg')` — Rollup sees those literal dynamic imports and bundles them as
  // their own chunks (checked: they WERE present in dist before this) even though this app never calls either
  // method (buildPdf draws shapes straight into the PDF, Task 6-7; no HTML or SVG is ever handed to jsPDF). They
  // are jsPDF's own optionalDependencies, resolvable in this pnpm store, but shipping three unused third-party
  // libraries (one of them an HTML sanitiser) in a desktop app's bundle is unwarranted size and surface. `external`
  // leaves the literal `import(...)` in jsPDF's own bundled copy unresolved at build time; it only matters if
  // `.html()`/`.addSvgAsImage()` are ever actually called, which nothing in this app does.
  build: { target: 'safari15', outDir: 'dist', rollupOptions: { external: ['html2canvas', 'dompurify', 'canvg'] } },
  // tokens.test.ts reads tokens.css via `?raw`; Vitest returns '' for CSS unless CSS processing is on.
  test: { css: true },
});
