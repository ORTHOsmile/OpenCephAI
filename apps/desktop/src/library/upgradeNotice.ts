/** AUTOBACKUP-1: the one-time notice after the app upgraded the library's format: where the safety copy is. */
export const upgradeNotice = (dir: string | null): string | null =>
  dir ? `Your library was upgraded to a new format. A safety copy from before the upgrade is in ${dir}. It holds patient data, like the library itself.` : null;
