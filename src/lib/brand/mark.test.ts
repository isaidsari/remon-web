import { describe, expect, it } from 'bun:test';
import { STATUS_COLOR, faviconSvg, fillWidth } from './mark';

describe('fillWidth', () => {
	it('keeps an idle unit visible', () => {
		expect(fillWidth(40, 0)).toBeCloseTo(4.8);
	});

	it('clamps out-of-range and missing values', () => {
		expect(fillWidth(40, 150)).toBe(40);
		expect(fillWidth(40, -5)).toBe(fillWidth(40, 0));
		expect(fillWidth(40, NaN)).toBe(fillWidth(40, 0));
	});
});

describe('faviconSvg', () => {
	it('lights the lamp in the status colour', () => {
		expect(faviconSvg(undefined, 'crit')).toContain(STATUS_COLOR.crit);
		expect(faviconSvg(undefined, 'crit')).not.toContain(STATUS_COLOR.ok);
	});

	it('dims the units when the server is unreachable', () => {
		expect(faviconSvg(undefined, 'off')).toContain('opacity=".3"');
		expect(faviconSvg(undefined, 'ok')).not.toContain('opacity=".3"');
	});
});
