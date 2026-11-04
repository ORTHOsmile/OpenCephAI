/**
 * Quit (⌘Q or closing the window) waits for the last edit to be written (review #2). The Rust side holds the exit and
 * asks the web view to save; this runs the flush, then quits. A hung or failed save still quits after `timeoutMs`, so
 * the app can always be closed (Rust has its own, longer, backstop).
 */
export async function flushThenQuit(flush: () => Promise<unknown>, quit: () => unknown, timeoutMs = 4000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((res) => { timer = setTimeout(res, timeoutMs); });
  try { await Promise.race([flush().catch(() => undefined), timeout]); } finally { clearTimeout(timer); }
  await quit();
}
