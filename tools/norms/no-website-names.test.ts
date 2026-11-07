import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Owner, 7 Nov 2026: two websites are no longer named as the source of any norm. Every public norm set, source list,
// catalogue line, doc and test says "Data on file (primary source being confirmed)" instead; the norm numbers are
// unchanged. Which website each set really came from is kept in private records only, never exported. The two names are built from pieces here so this file does not spell them either (the same trick as
// credits.test.ts), or the public copy would contain them inside the rule that forbids them.
const FORBIDDEN = [['bc', 'eph'], ['b-', 'ceph'], ['dom', 'ery']].map((p) => p.join(''));
const RE = new RegExp(FORBIDDEN.join('|'), 'i');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Everything that travels in the clean copy. In the working repository the list is READ FROM scripts/export-clean.allow
// (one entry per line: a file, or a folder ending in /; "src => dst" means the working file src is exported), so a path
// added to the export is scanned from that moment, and a file that is not on the allow list (a private note) is not.
// In the clean copy itself that file is absent and everything present is exported, so every file is scanned.
const SKIP_DIRS = new Set(['node_modules', 'target', '.git', 'dist', 'gen']);
const BINARY = /\.(png|jpe?g|gif|ico|icns|onnx|ttf|otf|woff2?|pdf|zip|gz|bin|dmg|wasm|nib|car)$/i;

export function allowEntries(allowText: string): string[] {
  return allowText.split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map((l) => (l.includes('=>') ? l.split('=>')[0].trim() : l));
}

function walk(rel: string, out: string[]): void {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) return;
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    for (const n of fs.readdirSync(abs)) if (!SKIP_DIRS.has(n)) walk(path.join(rel, n), out);
  } else out.push(rel);
}

function publicFiles(): string[] {
  const allow = path.join(repoRoot, 'scripts', 'export-clean.allow');
  const roots = fs.existsSync(allow) ? allowEntries(fs.readFileSync(allow, 'utf8')) : fs.readdirSync(repoRoot);
  const out: string[] = [];
  for (const r of roots) walk(r.replace(/\/$/, ''), out);
  return [...new Set(out)];
}

/** Files and file names that name one of the two sites. Returns what it scanned too, so a scan of nothing can be refused. */
export function findNames(files: string[]): { scanned: number; hits: string[] } {
  const hits: string[] = [];
  let scanned = 0;
  for (const f of files) {
    if (RE.test(f)) hits.push(`${f}: the file name`);
    if (BINARY.test(f)) continue;
    let text: string;
    try { text = fs.readFileSync(path.join(repoRoot, f), 'utf8'); } catch { continue; }
    scanned++;
    text.split('\n').forEach((line, i) => { if (RE.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 90)}`); });
  }
  return { scanned, hits };
}

test('no public norm set, source list, catalogue line, doc or test names either website', () => {
  const files = publicFiles();
  const { scanned, hits } = findNames(files);
  // Never report "nothing found" from a scan that read nothing (positive-control rule): the reference tree alone holds hundreds of files.
  assert.ok(scanned > 300, `the guard read only ${scanned} files; it is not looking where it should`);
  assert.deepEqual(hits, []);
});

test('the guard can fail: a name in a file is found, and so is one in a file name (positive control)', () => {
  const tmp = fs.mkdtempSync(path.join(repoRoot, 'tools', 'norms', '.guard-control-'));
  try {
    const rel = path.relative(repoRoot, tmp);
    const bad = path.join(rel, ['bc', 'eph'].join('') + '-x.txt');
    fs.writeFileSync(path.join(repoRoot, bad), `norms from ${['dom', 'ery'].join('')}.com\n`);
    const { scanned, hits } = findNames([bad]);
    assert.equal(scanned, 1);
    assert.equal(hits.length, 2, hits.join(' | '));
    assert.equal(findNames([]).hits.length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the allow list is read: comments dropped, "src => dst" scans src, folders keep their slash (positive control)', () => {
  assert.deepEqual(allowEntries('# c\napps/\nCargo.toml  # x\n\ndocs/a.md => docs/b.md\n'), ['apps/', 'Cargo.toml', 'docs/a.md']);
  // The guard's list includes files the old hand list missed.
  const files = publicFiles();
  if (fs.existsSync(path.join(repoRoot, 'scripts', 'export-clean.allow'))) {
    for (const f of ['docs/CROSSCHECK-METHODOLOGY.md', 'scripts/make-dmg-background.py', 'Cargo.toml', 'docs/WHOLE-FILM-CHECK-METHODOLOGY.md']) {
      assert.ok(files.some((x) => x === f || x.startsWith(f + '/')), f);
    }
    assert.ok(!files.some((x) => x.endsWith('PRIVATE-ORIGINS.md')), 'a private note must not be scanned (it is not exported)');
  }
});
