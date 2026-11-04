// The app's version and build day, shown at the foot of Settings (owner, 19 Oct 2026). Both are written in at build
// time by vite.config.ts (`define`): the version from package.json (kept equal to tauri.conf.json and Cargo.toml by
// version.test.ts), the day the build was made as ISO YYYY-MM-DD in this Mac's local time.
import { formatDate, parseDateInput, type DateFormat } from './dates';

declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;
export const APP_VERSION: string = __APP_VERSION__;
export const BUILD_DATE: string = __BUILD_DATE__;

/** "OpenCephAI 0.1.0 · built 20/10/2026": the day in the operator's date format, like every other date on screen.
 *  Without a real ISO day (a build that did not write one in) the " · built …" part is left off, never half-shown. */
export const versionLine = (version: string, isoDay: string, f: DateFormat) =>
  /^\d{4}-\d{2}-\d{2}$/.test(isoDay) && parseDateInput(isoDay, f) ? `OpenCephAI ${version} · built ${formatDate(isoDay, f)}` : `OpenCephAI ${version}`;
