// Final review M7 (ruling, 25 Oct): a before/after across git states must come from TWO git
// states. A sweep run against itself can only ever report "no change", so it is refused unless an explicit self-check
// flag says that is what is meant. Shared by norms/ageRowSweep and export/machineScaleSweep (and, in the same format,
// crates/ceph-store/tests/machine_scale_sweep.rs `dump_docs`). Test-only: nothing in the app imports it.

/** A sweep or a dump as written to a file: which git state wrote it, and what it holds. */
export interface Stamped<T> { gitState: string | null; rows: T }

/** `before` and `after` are the git states of the two sides (null/undefined: the side does not say). Throws unless
 *  they are two different, known states; `selfCheck` (an explicit flag) lets a same-state or unstamped run through. */
export function requireTwoStates(before: string | null | undefined, after: string | null | undefined, selfCheck: boolean): void {
  if (selfCheck) return;
  if (!before || !after) {
    throw new Error(`the ${!before ? 'before' : 'after'} side does not say which git state it came from: write it again with this `
      + 'version of the sweep, or pass the self-check flag to compare without knowing');
  }
  if (before === after) {
    throw new Error(`before and after are the same git state (${before}): this compares the code with itself and cannot see a `
      + 'change. Write the before in the other state, or pass the self-check flag if a self-check is what you mean');
  }
}

export const stamped = <T>(gitState: string, rows: T): { gitState: string; rows: T } => ({ gitState, rows });
/** Reads a stamped file's JSON; an old bare array (written before M7) reads with no state. */
export function unstamp<T>(json: unknown): Stamped<T> {
  if (json && typeof json === 'object' && !Array.isArray(json) && 'rows' in json) {
    const j = json as { gitState?: unknown; rows: T };
    return { gitState: typeof j.gitState === 'string' && j.gitState ? j.gitState : null, rows: j.rows };
  }
  return { gitState: null, rows: json as T };
}

// The repo has no @types/node: node modules are reached type-erased, as export/unadjusted.golden.test.ts does.
const CP = 'node:child_process', CRYPTO = 'node:crypto';
type Exec = (file: string, args: string[], o: { encoding: 'utf8'; cwd?: string; input?: string; maxBuffer?: number }) => string;
/** This checkout's git state: the HEAD commit, plus `+` and 12 hex of a SHA-256 over the uncommitted changes (tracked
 *  diff, and every untracked, not-ignored file's name and content) when there are any — so the same commit edited is
 *  another state. The Rust `dump_docs` writes the same form. */
export async function gitState(cwd?: string): Promise<string> {
  const { execFileSync } = (await import(/* @vite-ignore */ CP)) as { execFileSync: Exec };
  const { createHash } = (await import(/* @vite-ignore */ CRYPTO)) as { createHash: (a: string) => { update: (s: string) => { digest: (e: 'hex') => string } } };
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', cwd }).trim();   // the whole checkout, not this folder
  const git = (args: string[], input?: string) => execFileSync('git', args, { encoding: 'utf8', cwd: top, input, maxBuffer: 1 << 30 });
  const head = git(['rev-parse', 'HEAD']).trim();
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  const contents = untracked.trim() ? git(['hash-object', '--stdin-paths'], untracked) : '';
  const dirty = git(['diff', 'HEAD', '--binary']) + untracked + contents;
  return dirty ? `${head}+${createHash('sha256').update(dirty).digest('hex').slice(0, 12)}` : head;
}
