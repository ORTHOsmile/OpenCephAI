import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Owner, 1 Nov 2026: "Program and Design: Dr Linton Nash" in the README, with a thanks to him. Repo root is two up.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readme = () => fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');

test('README.md has a Credits section with the exact credit and thanks lines', () => {
  const text = readme();
  const section = /^## Credits\s*\n([\s\S]*?)(?=^## |\s*$(?![\s\S]))/m.exec(text)?.[1] ?? '';
  assert.match(section, /^Program and Design: Dr Linton Nash$/m);
  assert.match(section, /^With thanks to Dr Linton Nash\.$/m);
});

test('README.md names no AI or tool', () => {
  assert.doesNotMatch(readme(), /assistant|company|co-authored/i);
});

// Owner, 2 Nov 2026: a short plain Roadmap (Now / Next / Later), no dates, no internal names.
test('README.md has a Roadmap with Now, Next and Later, and no dates or internal names', () => {
  const text = readme();
  const road = /^## Roadmap\s*\n([\s\S]*)$/m.exec(text)?.[1] ?? '';
  assert.match(road, /^### Now/m);
  assert.match(road, /^### Next/m);
  assert.match(road, /^### Later/m);
  for (const phrase of ['Automatic best', 'The profilogram', 'Superimposition', 'PDF report', 'CSV', 'Library table',
    'far outside the usual position', 'CVM', 'Windows']) assert.ok(road.includes(phrase), phrase);
  assert.doesNotMatch(road, /\b(20\d\d|Q[1-4]|HANDOVER|spec|branch|Tauri|SRPose|GU2Net|Aariz|Part F)\b/);
});

// Owner, 2 Nov 2026: the whole program is Beta; the README says so at the very top.
test('README.md opens with the Beta name and the Beta line, before anything else', () => {
  const lines = readme().split('\n').filter((l) => l.trim() !== '');
  assert.equal(lines[0], '# OpenCephAI 1.1 Beta');
  assert.match(lines[1], /^\*\*Beta:\*\* OpenCephAI is beta research software, not a diagnostic device\./);
});
