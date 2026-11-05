import { describe, it, expect } from 'vitest';
import titles from '../../../../crates/ceph-store/tests/fixtures/titles.json';
import { NOT_A_TITLE, splitTitle, titledName, titleIn } from './title';

describe('titleIn (owner T1, 19 Oct)', () => {
  it('reads every title on the shared table as printed, and refuses the rest', () => {
    for (const t of titles.accept) expect(titleIn(t), t).toBe(t);
    for (const t of titles.refuse) expect(titleIn(t), t).toBeNull();
  });
  it('drops a "Title:" label and a trailing comma, keeps the word as printed', () => {
    expect(titleIn('Title: Mr.')).toBe('Mr.');
    expect(titleIn('  MRS,  ')).toBe('MRS');
    expect(titleIn('')).toBeNull();
  });
  it('refuses with the owner\'s words', () => { expect(NOT_A_TITLE).toBe("That isn't a title (Mr, Mrs, Ms, Miss, Master, Dr…)"); });
});
describe('splitTitle: a Full name line starting with a title (owner T1; R5)', () => {
  it('puts the title in Title and the rest in the name', () => {
    expect(splitTitle('Mr John Smith')).toEqual({ title: 'Mr', rest: 'John Smith' });
    expect(splitTitle('Mr Demo')).toEqual({ title: 'Mr', rest: 'Demo' });
    expect(splitTitle('Dr.Smith')).toEqual({ title: 'Dr.', rest: 'Smith' });
    expect(splitTitle('Mstr Demo Junior')).toEqual({ title: 'Mstr', rest: 'Demo Junior' });
    expect(splitTitle('Mrs Smith, Jane')).toEqual({ title: 'Mrs', rest: 'Smith, Jane' });
  });
  it('leaves a name with no title as it is — a word that only starts like one, or a title alone', () => {
    for (const n of ['Drew Smith', 'Mrsmith Demo', 'Smith, John', 'Mr', 'Mister Demo', ''])
      expect(splitTitle(n), n).toEqual({ title: null, rest: n });
  });
});
describe('titledName: the title before the name (owner T1)', () => {
  it('"Mr John Smith"; no title, the name alone', () => {
    expect(titledName('Mr', 'John Smith')).toBe('Mr John Smith');
    expect(titledName(null, 'John Smith')).toBe('John Smith');
  });
});
