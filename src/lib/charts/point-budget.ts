/** Quantize resize changes to avoid a request for every pixel of a drag. */
export function chartPointBudget(width: number): number {
	if (!Number.isFinite(width) || width <= 0) return 300;
	return Math.max(100, Math.min(2000, Math.round(width / 100) * 50));
}
