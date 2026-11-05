// Owner, 2 Nov 2026: the whole program is labelled Beta. The name below is the window title and index.html <title>
// (productName stays "OpenCephAI" so only one .app is built; the About copyright line carries "1.1 Beta"); the bundle identifier is deliberately unchanged.
export const BETA_NAME = 'OpenCephAI 1.1 Beta';
export const BETA_NOTICE = 'OpenCephAI is beta research software, not a diagnostic device. Every point must be checked by a clinician. Please report any problem.';
/** Remembered once dismissed, per Mac, like any other UI choice (settings table; `library/view.ts` is the pattern). */
export const BETA_NOTICE_KEY = 'betaNoticeSeen';
export const parseBetaSeen = (v: string | null | undefined): boolean => v === '1';
