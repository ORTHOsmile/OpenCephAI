import { defineConfig } from 'vitest/config';

// Plan 2026-10-19-norms-auto: the norms before/after probe. Collected ONLY by this config (`*.probe.ts` never matches the
// default test pattern), so `pnpm test` never runs it. Run: NORMS_PROBE_OUT=<file> vitest run --config vitest.probe.config.ts
export default defineConfig({ test: { include: ['probe/**/*.probe.ts'], testTimeout: 3_600_000 } });
