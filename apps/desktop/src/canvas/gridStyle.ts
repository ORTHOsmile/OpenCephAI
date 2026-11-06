/** The mm grid's look, in ONE place (owner, 6 Nov 2026): the window's overlay (`Overlay.tsx`) and the PDF report's profilogram page
 *  (`report/shapes.ts`) both read it, so they cannot drift apart. `token` is the CSS colour variable (`styles/tokens.css`; the PDF takes
 *  that token's light value from `docs/design/tokens.json`, the file tokens.css is generated from); `px` is the line weight in CSS pixels
 *  on screen; `opacity` is 1 (solid) on screen and in the PDF. Minor = every 1 mm, mid = every 5 mm, major = every 10 mm, axis = the two
 *  lines through Po. */
export const GRID_STYLE = {
  minor: { token: 'grid-minor', px: 0.5, opacity: 1 },
  mid: { token: 'grid-mid', px: 0.8, opacity: 1 },
  major: { token: 'grid-major', px: 1.1, opacity: 1 },
  axis: { token: 'grid-axis', px: 1.6, opacity: 1 },
} as const;
/** One CSS pixel (1/96 inch) in millimetres: how the PDF turns the screen's px weights into page weights. */
export const MM_PER_PX = 25.4 / 96;
