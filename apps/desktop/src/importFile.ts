// Which files can be imported, shared by the Open dialog (⌘O) and drag-and-drop onto the window.
// PNG, JPEG, TIFF and BMP only: DICOM is out of scope (decision 21b).
export const CEPH_EXTENSIONS = ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp'];

export const fileNameOf = (path: string): string => path.split(/[\\/]/).pop() ?? path;

const extensionOf = (path: string): string | null => {
  const m = /\.([A-Za-z0-9]+)$/.exec(fileNameOf(path));
  return m ? m[1].toLowerCase() : null;
};

/** Every supported image among the dropped paths, plus the names of what was refused (folders, other formats). */
export function pickDroppedCephs(paths: string[]): { paths: string[]; rejected: string[] } {
  const ok = paths.filter((p) => CEPH_EXTENSIONS.includes(extensionOf(p) ?? ''));
  const rejected = paths.filter((p) => !ok.includes(p)).map((p) => fileNameOf(p.replace(/[\\/]+$/, '')) || p);
  return { paths: ok, rejected };
}
export const refusedMessage = (names: string[]) =>
  names.length ? `Can’t import ${names.map((n) => `“${n}”`).join(', ')}. Drop PNG, JPEG, TIFF or BMP cephalograms.` : null;
