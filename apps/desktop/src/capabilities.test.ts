import { describe, it, expect } from 'vitest';
import capability from '../src-tauri/capabilities/default.json';

describe('window permissions', () => {
  it('the toolbar can drag the window (overlay title bar: data-tauri-drag-region needs start-dragging)', () => {
    expect(capability.permissions).toContain('core:window:allow-start-dragging');
  });

  it('the save dialog is allowed (Report preview ▸ Save PDF… / Export CSV…, spec 2026-10-17)', () => {
    expect(capability.permissions).toContain('dialog:allow-save');
  });
});
