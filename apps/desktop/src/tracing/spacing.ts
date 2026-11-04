/** The Ceph-400 convention, used until the ruler is calibrated (decision 17) and always labelled "assumed". */
export const ASSUMED_MM_PER_PX = 0.1;
export interface Scale { mmPerPx: number; source: 'calibration' | 'assumed' }
export const scaleOf = (spacingMm: number | null | undefined): Scale =>
  spacingMm !== null && spacingMm !== undefined && Number.isFinite(spacingMm) && spacingMm > 0
    ? { mmPerPx: spacingMm, source: 'calibration' } : { mmPerPx: ASSUMED_MM_PER_PX, source: 'assumed' };
export const scaleLabel = (s: Scale) =>
  (s.source === 'calibration' ? `${s.mmPerPx.toFixed(4)} mm/px (calibrated)` : `${s.mmPerPx} mm/px (assumed: calibrate with K)`);
