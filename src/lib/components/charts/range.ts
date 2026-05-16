export type RangeKey = '30m' | '1h' | '6h' | '24h' | '7d' | '30d';

export const RANGE_SECONDS: Record<RangeKey, number> = {
	'30m': 1800,
	'1h': 3600,
	'6h': 21600,
	'24h': 86400,
	'7d': 604800,
	'30d': 2592000
};
