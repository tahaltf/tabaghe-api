/** نگاشت امتیاز یکپارچه ۰–۵ به مقیاس legacy ۰–۱۰۰ */
export const TRUST_POINTS_PER_RATING_UNIT = 20;

export function ratingToTrustScore(rating: number): number {
  const normalized = Number(rating);
  if (!Number.isFinite(normalized)) return 100;
  return Math.round(Math.min(100, Math.max(0, normalized * TRUST_POINTS_PER_RATING_UNIT)));
}

export function trustPointsToRatingDelta(trustPoints: number): number {
  const normalized = Number(trustPoints);
  if (!Number.isFinite(normalized) || normalized === 0) return 0;
  return normalized / TRUST_POINTS_PER_RATING_UNIT;
}

export function effectiveTrustScoreFromRating(rating: number | null | undefined): number {
  return ratingToTrustScore(Number(rating ?? 5));
}

export function minRatingFromTrustThreshold(trustThreshold: number): number {
  return trustThreshold / TRUST_POINTS_PER_RATING_UNIT;
}
