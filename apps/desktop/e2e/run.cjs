// Runs every browser smoke against a served build and fails if any check fails. SYNTHETIC data only.
// Usage (from apps/desktop): ./node_modules/.bin/vite build && ./node_modules/.bin/vite preview --port 4173 --strictPort &  then  node e2e/run.cjs [e2e5 …]
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
const here = __dirname;
if (!fs.existsSync(path.join(here, 'out', 'synthetic.png'))) execFileSync(process.execPath, [path.join(here, 'mkpng.cjs')], { stdio: 'inherit' });
// Final review M-4: refuse to test a server other than this build. If port 4173 was already held, `vite preview
// --strictPort` fails to start, and the smokes would silently run against whatever stale server answers there. Vite's
// hashed asset names make any other build's index.html differ, so the served page must equal dist/index.html byte for byte.
const guard = spawnSync(process.execPath, ['-e', `fetch('http://localhost:4173/').then((r) => r.text()).then((t) => process.stdout.write(t)).catch((e) => { console.error(String(e)); process.exit(3); })`], { encoding: 'utf8', timeout: 15000 });
const built = path.join(here, '..', 'dist', 'index.html');
if (guard.status !== 0) { console.log(`nothing answered on port 4173 (${(guard.stderr || '').trim()}) — start the preview first`); process.exit(2); }
if (!fs.existsSync(built) || guard.stdout !== fs.readFileSync(built, 'utf8')) {
  console.log('port 4173 is serving a different build than dist/ — stop the old preview'); process.exit(2);
}
const wanted = process.argv.slice(2);
const smokes = fs.readdirSync(here).filter((f) => /^e2e\d+\.cjs$/.test(f)).filter((f) => !wanted.length || wanted.includes(f.replace('.cjs', '')));
let failed = 0;
for (const f of smokes) {
  const r = spawnSync(process.execPath, [path.join(here, f)], { encoding: 'utf8', timeout: 300000 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const pass = (out.match(/^PASS/gm) ?? []).length, fail = (out.match(/^FAIL/gm) ?? []).length;
  const broken = r.status !== 0 || !pass;
  console.log(`${f}: ${pass} pass, ${fail} fail${broken ? ' (did not finish)' : ''}`);
  if (fail || broken) { failed++; console.log(out.split('\n').filter((l) => !l.startsWith('PASS')).join('\n')); }
}
process.exit(failed ? 1 : 0);
