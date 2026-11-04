import { describe, it, expect } from 'vitest';
import { ALL_ANALYSES, BUILT_INS } from './analyses';
import { buildRegistry } from './registry';

describe('the registry is the whole catalogue, whichever analyses build it', () => {
  it('buildRegistry(ALL_ANALYSES) equals buildRegistry(BUILT_INS)', () => {
    expect(buildRegistry(ALL_ANALYSES)).toEqual(buildRegistry(BUILT_INS));
  });
});
