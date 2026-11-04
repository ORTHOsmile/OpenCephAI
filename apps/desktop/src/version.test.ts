import { describe, it, expect } from 'vitest';
import pkg from '../package.json';
import tauriConf from '../src-tauri/tauri.conf.json';
import cargoToml from '../src-tauri/Cargo.toml?raw';
import { APP_VERSION, BUILD_DATE, versionLine } from './version';

// Owner, 19 Oct 2026: builds carry semantic version numbers (0.2.0, then 0.3.0 for features, 0.2.1 for fix-only),
// bumped at install time. The number lives in three files; they must never disagree.
const cargoVersion = () => /^\[package\][^[]*?^version\s*=\s*"([^"]+)"/m.exec(cargoToml)?.[1];

describe('one version number', () => {
  it('package.json, tauri.conf.json and Cargo.toml carry the same version', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(tauriConf.version).toBe(pkg.version);
    expect(cargoVersion()).toBe(pkg.version);
  });

  it('the screen is given the package.json version and a real build day', () => {
    expect(APP_VERSION).toBe(pkg.version);
    expect(BUILD_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(BUILD_DATE))).toBe(false);
  });
});

describe('the version line at the foot of Settings', () => {
  it('reads "OpenCephAI <version> · built <day>", the day in the operator’s date format', () => {
    expect(versionLine('0.1.0', '2026-10-20', 'AU')).toBe('OpenCephAI 0.1.0 · built 20/10/2026');
    expect(versionLine('0.2.1', '2026-10-20', 'US')).toBe('OpenCephAI 0.2.1 · built 10/20/2026');
  });

  it('without a real build day, drops " · built …" rather than leaving a dangling "built"', () => {
    expect(versionLine('0.1.0', '', 'AU')).toBe('OpenCephAI 0.1.0');
    expect(versionLine('0.1.0', 'undefined', 'AU')).toBe('OpenCephAI 0.1.0');
    expect(versionLine('0.1.0', '2026-13-45', 'AU')).toBe('OpenCephAI 0.1.0');
  });
});

describe('About and Finder’s Get Info carry the research statement', () => {
  it('bundle.copyright says it is a research tool, not a diagnostic device', () => {
    expect((tauriConf.bundle as Record<string, unknown>).copyright).toBe('Research tool — not a diagnostic device.');
  });
});
