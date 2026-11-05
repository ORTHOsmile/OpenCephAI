import { describe, it, expect } from 'vitest';
import { csvBytes, field, guardFormula, toCsv } from './csv';

describe('CSV fields (RFC 4180, master plan §8)', () => {
  it('quotes a field holding a comma, a quote or a line break, doubling the quotes', () => {
    expect(field('a,b')).toBe('"a,b"');
    expect(field('say "hi"')).toBe('"say ""hi"""');
    expect(field('two\nlines')).toBe('"two\nlines"');
    expect(field('cr\rx')).toBe('"cr\rx"');
    expect(field('plain')).toBe('plain');
  });
  it('numbers at full precision with a dot; null, NaN and Infinity are empty', () => {
    expect(field(84.71234567891234)).toBe('84.71234567891234');
    expect(field(-2.5)).toBe('-2.5');
    expect([field(null), field(NaN), field(Infinity)]).toEqual(['', '', '']);
  });
  it('a text cell Excel would run as a formula is shown as plain text; a number keeps its minus', () => {
    expect(guardFormula('=1+1')).toBe("'=1+1");
    expect(field('=HYPERLINK("x")', true)).toBe(`"'=HYPERLINK(""x"")"`);
    expect(field('-Class II', true)).toBe("'-Class II");
    expect(field('+1', true)).toBe("'+1");
    expect(field('@SUM', true)).toBe("'@SUM");
    expect(field(-3, true)).toBe('-3');
    expect(field('Class II', true)).toBe('Class II');
    expect(field('=not guarded in a number column')).toBe('=not guarded in a number column');
  });
});

describe('a CSV file for Excel', () => {
  const cols = [{ name: 'patient', get: (r: { n: string; v: number | null }) => r.n, text: true },
    { name: 'value', get: (r: { n: string; v: number | null }) => r.v }];
  it('starts with the byte-order mark, ends each line with CRLF, and keeps unicode names', () => {
    const csv = toCsv(cols, [{ n: 'Zoë SYNTHETIC 李', v: 1.5 }, { n: 'Demo, SYNTHETIC', v: null }]);
    expect(csv).toBe('﻿patient,value\r\nZoë SYNTHETIC 李,1.5\r\n"Demo, SYNTHETIC",\r\n');
    const b = csvBytes(csv);
    expect([...b.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(b.slice(3))).toBe('patient,value\r\nZoë SYNTHETIC 李,1.5\r\n"Demo, SYNTHETIC",\r\n');
  });
  it('no rows: the heading line alone', () => {
    expect(toCsv(cols, [])).toBe('﻿patient,value\r\n');
  });
});
