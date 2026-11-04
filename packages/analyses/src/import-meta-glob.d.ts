// Types for Vite's `import.meta.glob`, used by norms/load.ts (Vitest and the desktop app's Vite
// build both transform it). `vite` is not a dependency of this package and is not resolvable from
// it (pnpm keeps it inside vitest's and apps/desktop's own trees), so `vite/client` cannot be
// referenced here without adding a dependency. Only the call shape load.ts uses is declared.
interface ImportMeta {
  glob<T = unknown>(
    pattern: string | string[],
    options?: { eager?: boolean; import?: string; query?: string | Record<string, string> },
  ): Record<string, T>;
}

// Part D (Task 1): tests read the owner-reviewed appendix as text, through Vite's `?raw`.
declare module '*.md?raw' {
  const text: string;
  export default text;
}
