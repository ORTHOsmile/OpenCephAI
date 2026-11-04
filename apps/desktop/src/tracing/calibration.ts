import type { Vec2 } from '@ceph/geometry';

export const MIN_CALIBRATION_PX = 20;                 // the same limit ceph-store enforces
export const SHORT_SPAN_MM = 20;
export type CalibrationCheck = { ok: true; mmPerPx: number; px: number; warning: string | null } | { ok: false; error: string };

/** spacing = D_mm / ‖p1 − p2‖ (§2, decision 17). The dialog explains a refusal before anything is saved. */
export function checkCalibration(p1: Vec2, p2: Vec2, mm: number): CalibrationCheck {
  const px = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (!(px >= MIN_CALIBRATION_PX)) return { ok: false, error: `The marks are ${px.toFixed(1)} px apart; pick two ruler marks at least ${MIN_CALIBRATION_PX} px apart.` };
  if (!Number.isFinite(mm) || mm <= 0) return { ok: false, error: 'Enter the true distance between the marks in millimetres.' };
  return { ok: true, mmPerPx: mm / px, px,
    warning: mm < SHORT_SPAN_MM ? `Marks ${mm} mm apart: one pixel of click error changes the scale by ${(100 / px).toFixed(1)}%. Marks further apart are more accurate.` : null };
}

/** Top-left position for a dragged panel that keeps all of it inside the window (8 px margin). */
export function clampPanel(p: Vec2, size: { w: number; h: number }, win: { w: number; h: number }, margin = 8): Vec2 {
  return {
    x: Math.min(Math.max(margin, p.x), Math.max(margin, win.w - size.w - margin)),
    y: Math.min(Math.max(margin, p.y), Math.max(margin, win.h - size.h - margin)),
  };
}
