import { describe, it, expect } from 'vitest';
import { datePlaceholder, formatDate, parseDateFormat, parseDateInput } from './dates';

describe('dates in the operator’s format (stored ISO)', () => {
  it('shows ISO dates day first (AU) or month first (US)', () => {
    expect(formatDate('1990-03-07', 'AU')).toBe('07/03/1990');
    expect(formatDate('1990-03-07', 'US')).toBe('03/07/1990');
    expect(formatDate('2026-09-01T10:00:00.000Z', 'AU')).toBe('01/09/2026');
    expect(formatDate(null, 'AU')).toBe('');
  });
  it('reads a typed date in the operator’s order, or ISO', () => {
    expect(parseDateInput('7/3/1990', 'AU')).toBe('1990-03-07');
    expect(parseDateInput('7/3/1990', 'US')).toBe('1990-07-03');
    expect(parseDateInput('07.03.1990', 'AU')).toBe('1990-03-07');
    expect(parseDateInput('07-03-1990', 'AU')).toBe('1990-03-07');
    expect(parseDateInput('1990-03-07', 'US')).toBe('1990-03-07');
    expect(parseDateInput('29/02/2024', 'AU')).toBe('2024-02-29');
    expect(parseDateInput('   ', 'AU')).toBeNull();
  });
  it('refuses dates that do not exist or are not dates', () => {
    expect(parseDateInput('31/02/2020', 'AU')).toBeUndefined();
    expect(parseDateInput('13/25/2020', 'US')).toBeUndefined();
    expect(parseDateInput('7 March', 'AU')).toBeUndefined();
    expect(parseDateInput('7/3/90', 'AU')).toBeUndefined();                  // four-digit years when typing
  });
  it('defaults to Australian order and names the pattern', () => {
    expect(parseDateFormat(null)).toBe('AU');
    expect(parseDateFormat('US')).toBe('US');
    expect(parseDateFormat('xx')).toBe('AU');
    expect([datePlaceholder('AU'), datePlaceholder('US')]).toEqual(['DD/MM/YYYY', 'MM/DD/YYYY']);
  });
});
