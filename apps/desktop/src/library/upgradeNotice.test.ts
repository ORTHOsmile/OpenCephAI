import { describe, expect, it } from 'vitest';
import { upgradeNotice } from './upgradeNotice';

// AUTOBACKUP-1: after the app upgrades the library's format, the notice says where the safety copy is.
describe('upgradeNotice', () => {
  it('names the folder of the safety copy', () => {
    expect(upgradeNotice('/lib/upgrade-backups/OpenCephAI backup before upgrade 8→9 2026-10-13 10-00-00'))
      .toBe('Your library was upgraded to a new format. A safety copy from before the upgrade is in '
        + '/lib/upgrade-backups/OpenCephAI backup before upgrade 8→9 2026-10-13 10-00-00. It holds patient data, like the library itself.');
  });
  it('is nothing when no upgrade happened', () => {
    expect(upgradeNotice(null)).toBeNull();
  });
});
