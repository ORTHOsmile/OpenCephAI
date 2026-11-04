import { describe, it, expect } from 'vitest';
import { CEPH_EXTENSIONS, fileNameOf, pickDroppedCephs } from './importFile';

describe('dropped-file import', () => {
  it('keeps every supported image, in order, with its full path', () => {
    expect(pickDroppedCephs(['/a/notes.txt', '/a/lat.TIFF', '/a/b.jpg'])).toEqual({ paths: ['/a/lat.TIFF', '/a/b.jpg'], rejected: ['notes.txt'] });
  });
  it('names what it refused, including folders and DICOM (decision 21)', () => {
    expect(pickDroppedCephs(['/a/scan.dcm', '/Users/me/Cases', '/Users/me/archive.png/'])).toEqual({ paths: [], rejected: ['scan.dcm', 'Cases', 'archive.png'] });
  });
  it('treats an empty drop as nothing to do', () => { expect(pickDroppedCephs([])).toEqual({ paths: [], rejected: [] }); });
  it('uses the same extensions as the Open dialog', () => {
    expect(CEPH_EXTENSIONS).toEqual(['png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp']);
  });
  it('names files from macOS and Windows paths', () => {
    expect(fileNameOf('/Users/me/ceph.png')).toBe('ceph.png');
    expect(fileNameOf('C:\\cases\\ceph.png')).toBe('ceph.png');
  });
});
