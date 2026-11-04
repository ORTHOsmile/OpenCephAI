// Plan §11: points are coloured by *calibrated predicted error*, never by a raw network score. The HRNet heatmap peak
// is not a probability (8.5–26.8 on Ceph-400) and barely tracks error (Spearman ρ = −0.07), so until §11's calibration
// exists every AI point looks the same and is labelled unverified. Green/amber/red stay reserved for §11.
export const AI_POINT_LABEL = 'AI · unverified';
export const aiPointColour = (_rawScore?: number): string => 'var(--mark-ai)';
