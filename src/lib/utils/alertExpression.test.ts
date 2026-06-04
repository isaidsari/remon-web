import { describe, it, expect } from 'bun:test';
import { parseExpression, buildExpression, describeExpression } from './alertExpression';

describe('parseExpression', () => {
	it('parses a bare namespace.field comparator threshold', () => {
		expect(parseExpression('cpu.usage_percent > 80')).toEqual({
			namespace: 'cpu',
			field: 'usage_percent',
			labels: {},
			comparator: '>',
			threshold: '80'
		});
	});

	it('parses a single label', () => {
		const p = parseExpression('service.up{unit="nginx.service"} == 0');
		expect(p).not.toBeNull();
		expect(p?.labels).toEqual({ unit: 'nginx.service' });
		expect(p?.comparator).toBe('==');
		expect(p?.threshold).toBe('0');
	});

	it('parses multiple labels', () => {
		const p = parseExpression('pressure.some_avg60{resource="cpu",foo="bar"} > 10');
		expect(p?.labels).toEqual({ resource: 'cpu', foo: 'bar' });
	});

	it('accepts decimals and negatives', () => {
		expect(parseExpression('cpu.load_1m > 1.5')?.threshold).toBe('1.5');
		expect(parseExpression('cpu.steal_percent > -2')?.threshold).toBe('-2');
	});

	it('accepts scientific notation thresholds', () => {
		expect(parseExpression('disk.used_bytes{mount_point="/"} > 1e9')?.threshold).toBe('1e9');
		expect(parseExpression('memory.swap_in_pages_per_sec > 1.5e-3')?.threshold).toBe('1.5e-3');
		expect(parseExpression('disk.used_bytes > 2E10')?.threshold).toBe('2E10');
	});

	it('returns null for inputs that do not match the grammar', () => {
		expect(parseExpression('not an expression')).toBeNull();
		expect(parseExpression('cpu.usage_percent >')).toBeNull();
		expect(parseExpression('Cpu.Usage > 1')).toBeNull();
	});
});

describe('buildExpression', () => {
	it('drops empty label values so a half-filled form still serializes', () => {
		expect(
			buildExpression({
				namespace: 'disk',
				field: 'used_bytes',
				labels: { mount_point: '' },
				comparator: '>',
				threshold: '1000'
			})
		).toBe('disk.used_bytes > 1000');
	});

	it('defaults an empty threshold to 0', () => {
		expect(
			buildExpression({
				namespace: 'cpu',
				field: 'usage_percent',
				labels: {},
				comparator: '>',
				threshold: ''
			})
		).toBe('cpu.usage_percent > 0');
	});

	it('round-trips a parsed expression with labels', () => {
		const expr = 'service.up{unit="nginx.service"} == 0';
		expect(buildExpression(parseExpression(expr)!)).toBe(expr);
	});
});

describe('describeExpression', () => {
	it('renders service-up as a state sentence', () => {
		expect(describeExpression('service.up{unit="nginx.service"} == 0', null)).toBe(
			'Service nginx.service is down'
		);
		expect(describeExpression('service.up{unit="db"} == 1', null)).toBe('Service db is up');
	});

	it('falls back to the raw expression when the shape is unfamiliar', () => {
		expect(describeExpression('totally bogus', null)).toBe('totally bogus');
	});

	it('describes a scientific-notation threshold instead of falling back to raw', () => {
		// Pre-fix this returned the raw expression because the regex rejected `1e9`.
		expect(describeExpression('cpu.usage_percent > 1e9', null)).toBe('cpu.usage_percent over 1e9');
	});
});
