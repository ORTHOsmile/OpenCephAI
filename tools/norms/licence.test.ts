import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo root is two levels up from tools/norms.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function listFiles(dir: string, name: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(repoRoot, full);
    if (rel.startsWith('tools/third_party') || rel.includes('node_modules')) continue;
    if (entry.isDirectory()) {
      listFiles(full, name, out);
    } else if (entry.name === name) {
      out.push(full);
    }
  }
  return out;
}

test('LICENSE starts with the Required Notice and carries the PolyForm licence name', () => {
  const text = fs.readFileSync(path.join(repoRoot, 'LICENSE'), 'utf8');
  assert.match(text, /^Required Notice: Copyright © 2026 Dr Linton Nash\. OpenCephAI\./);
  assert.match(text, /PolyForm Noncommercial License 1\.0\.0/);
});

test('no package.json or Cargo.toml in the repo declares GPL (excluding tools/third_party and node_modules)', () => {
  const candidates = [
    ...listFiles(repoRoot, 'package.json'),
    ...listFiles(repoRoot, 'Cargo.toml'),
  ];
  assert.ok(candidates.length > 0, 'the scan must find at least one package.json/Cargo.toml to be meaningful');
  const offenders = candidates.filter((f) => /GPL/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
});
