import { describe, it, expect } from 'bun:test';
import { fmtBytes, fmtBps, fmtPercent, fmtNumber, fmtScalar, fmtDuration } from './format';

// No locale is selected under bun, so these assert the base locale (en). The
// point of the suite is that the numbers go through Intl at all: before this,
// every figure in the UI was formatted with `toFixed` and a Turkish operator
// read English decimals — `1.2 GB` where the language calls for `1,2 GB`.
describe('fmtBytes', () => {
	it('scales by 1024 and labels in SI', () => {
		expect(fmtBytes(1024)).toBe('1.0 KB');
		expect(fmtBytes(1024 ** 3 * 1.5)).toBe('1.5 GB');
	});

	it('drops the fraction for plain bytes', () => {
		expect(fmtBytes(512)).toBe('512 B');
	});

	it('answers 0 B for nothing, negatives and non-numbers', () => {
		expect(fmtBytes(0)).toBe('0 B');
		expect(fmtBytes(-1)).toBe('0 B');
		expect(fmtBytes(Number.NaN)).toBe('0 B');
	});

	it('stops scaling at the largest unit it knows', () => {
		expect(fmtBytes(1024 ** 7)).toContain('PB');
	});
});

describe('fmtBps', () => {
	it('is a byte size per second', () => {
		expect(fmtBps(1024 ** 2 * 4.5)).toBe('4.5 MB/s');
	});
});

describe('fmtPercent', () => {
	it('takes 0-100 and lets the locale place the sign', () => {
		expect(fmtPercent(12.34)).toBe('12.3%');
		expect(fmtPercent(100)).toBe('100.0%');
	});

	it('renders a dash rather than NaN%', () => {
		expect(fmtPercent(Number.NaN)).toBe('—');
	});
});

describe('fmtNumber', () => {
	it('groups thousands', () => {
		expect(fmtNumber(1234567.891)).toBe('1,234,567.89');
	});

	it('honours the requested digits', () => {
		expect(fmtNumber(0.75)).toBe('0.75');
		expect(fmtNumber(1234.5, 0)).toBe('1,235');
	});

	it('renders a dash for non-numbers', () => {
		expect(fmtNumber(Number.POSITIVE_INFINITY)).toBe('—');
	});
});

describe('fmtScalar', () => {
	// `3 bans` reads better than `3.00 bans`, but a count of 1234 still wants
	// its separator — the integer branch used to skip formatting entirely.
	it('keeps integers whole and still groups them', () => {
		expect(fmtScalar(3)).toBe('3');
		expect(fmtScalar(1234)).toBe('1,234');
	});

	it('gives floats two digits', () => {
		expect(fmtScalar(1.5)).toBe('1.50');
	});
});

describe('fmtDuration', () => {
	it('shows the two largest units that matter', () => {
		expect(fmtDuration(90)).toBe('1m 30s');
		expect(fmtDuration(3661)).toBe('1h 1m');
		expect(fmtDuration(86_400 * 2 + 3600 * 3)).toBe('2d 3h');
	});

	// The hand-rolled version padded these with a unit carrying no information.
	it('drops a trailing zero unit', () => {
		expect(fmtDuration(86_400 * 9)).toBe('9d');
		expect(fmtDuration(3600)).toBe('1h');
	});

	// A zero duration is the one case where every unit is zero, and the
	// formatter's `auto` display would render an empty string for it.
	it('still says 0s for nothing', () => {
		expect(fmtDuration(0)).toBe('0s');
		expect(fmtDuration(-5)).toBe('0s');
		expect(fmtDuration(Number.NaN)).toBe('0s');
	});
});
