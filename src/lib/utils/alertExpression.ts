/**
 * Helpers for the alert-rule editor.
 *
 * The expression grammar (mirrored from the Rust resolver) is intentionally
 * tiny: `namespace.field{label="value", …}? comparator number`. These
 * utilities let the form pick it apart, reassemble it, and render it back
 * as something a non-power-user can read in the rules list.
 */
import type { AlertsSchemaResponse, NamespaceSchema } from '$lib/types/api';

export interface ParsedExpression {
	namespace: string;
	field: string;
	labels: Record<string, string>;
	comparator: string;
	threshold: string;
}

// Threshold: int/decimal/scientific (1e9, 1.5e-3) so byte rules pretty-print.
const EXPR_RE =
	/^\s*([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)(\{[^}]*\})?\s*(>=|<=|==|!=|>|<)\s*(-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)\s*$/;

/** Best-effort parse. Returns null when the input doesn't match the grammar
 *  the resolver expects; caller should fall back to "raw" mode. */
export function parseExpression(expr: string): ParsedExpression | null {
	const m = expr.match(EXPR_RE);
	if (!m) return null;
	const [, namespace, field, rawLabels, comparator, threshold] = m;
	const labels: Record<string, string> = {};
	if (rawLabels) {
		// `{a="x",b="y"}` → strip braces, split by `,`, then `=`.
		const inner = rawLabels.slice(1, -1).trim();
		if (inner.length > 0) {
			for (const pair of inner.split(',')) {
				const eq = pair.indexOf('=');
				if (eq <= 0) return null;
				const k = pair.slice(0, eq).trim();
				const v = pair.slice(eq + 1).trim();
				if (!v.startsWith('"') || !v.endsWith('"')) return null;
				labels[k] = v.slice(1, -1);
			}
		}
	}
	return { namespace, field, labels, comparator, threshold };
}

/** Serialize the form-state pieces into the canonical wire shape the resolver
 *  accepts. Empty label values are dropped so a half-filled form still produces
 *  a valid expression for partial validation. */
export function buildExpression(parts: ParsedExpression): string {
	const cleanLabels: string[] = [];
	for (const [k, v] of Object.entries(parts.labels)) {
		if (v != null && v !== '') cleanLabels.push(`${k}="${v}"`);
	}
	const labelBlock = cleanLabels.length > 0 ? `{${cleanLabels.join(',')}}` : '';
	const thr = parts.threshold === '' ? '0' : parts.threshold;
	return `${parts.namespace}.${parts.field}${labelBlock} ${parts.comparator} ${thr}`;
}

/**
 * Render an expression as a single human-readable sentence for the rules
 * list. Falls back to the raw expression if the shape is unfamiliar — the
 * UI then displays it in the code style block as before.
 *
 * Examples:
 *   `service.up{unit="nginx.service"} == 0`  → "Service nginx.service down"
 *   `cpu.usage_percent > 80`                 → "CPU usage over 80%"
 *   `disk.used_bytes{mount_point="/"} > 1e9` → "Disk / used > 1,000,000,000 bytes"
 */
export function describeExpression(expr: string, schema: AlertsSchemaResponse | null): string {
	const p = parseExpression(expr);
	if (!p) return expr;

	// Service-up is the canonical "state-as-int" case — render it state-y.
	if (p.namespace === 'service' && p.field === 'up') {
		const unit = p.labels['unit'] ?? '?';
		if (p.comparator === '==' && p.threshold === '0') return `Service ${unit} is down`;
		if (p.comparator === '==' && p.threshold === '1') return `Service ${unit} is up`;
		if (p.comparator === '!=' && p.threshold === '1') return `Service ${unit} is down`;
		if (p.comparator === '!=' && p.threshold === '0') return `Service ${unit} is up`;
	}

	const ns = schema?.namespaces.find((n) => n.name === p.namespace) ?? null;
	const metric = ns?.metrics.find((mm) => mm.name === p.field) ?? null;
	const metricLabel = metric?.description ?? `${p.namespace}.${p.field}`;
	const unitSuffix = metric?.unit ? ` ${metric.unit}` : '';

	const opDisplay: Record<string, string> = {
		'>': 'over',
		'>=': 'at or over',
		'<': 'below',
		'<=': 'at or below',
		'==': 'equals',
		'!=': 'not equal to'
	};
	const opStr = opDisplay[p.comparator] ?? p.comparator;

	const labelParts = Object.entries(p.labels)
		.filter(([, v]) => v !== '')
		.map(([k, v]) => `${k}=${v}`);
	const labelSuffix = labelParts.length > 0 ? ` (${labelParts.join(', ')})` : '';

	return `${metricLabel}${labelSuffix} ${opStr} ${p.threshold}${unitSuffix}`;
}

// dot-separated path walker; `[]` suffix means iterate array elements
export function walkJsonPath(root: unknown, path: string): string[] {
	const tokens = path.split('.').filter((t) => t.length > 0);
	let current: unknown[] = [root];
	for (const tok of tokens) {
		const isArrayStep = tok.endsWith('[]');
		const key = isArrayStep ? tok.slice(0, -2) : tok;
		const next: unknown[] = [];
		for (const node of current) {
			if (node == null || typeof node !== 'object') continue;
			const sub = (node as Record<string, unknown>)[key];
			if (sub == null) continue;
			if (isArrayStep) {
				if (Array.isArray(sub)) next.push(...sub);
			} else {
				next.push(sub);
			}
		}
		current = next;
	}
	// Collect string leaves; ignore everything else so callers don't have to
	// type-narrow the result.
	const out: string[] = [];
	for (const node of current) {
		if (typeof node === 'string') out.push(node);
	}
	return out;
}

export interface AlertTemplate {
	id: string;
	title: string;
	summary: string;
	/** Builder pre-fill. Empty label values become inputs the user fills in. */
	parts: ParsedExpression;
	severity: 'warn' | 'crit';
	for_duration_secs?: number;
	cooldown_secs?: number;
}

export const ALERT_TEMPLATES: AlertTemplate[] = [
	{
		id: 'cpu-high',
		title: 'CPU usage high',
		summary: 'Fires when overall CPU stays above the threshold.',
		parts: {
			namespace: 'cpu',
			field: 'usage_percent',
			labels: {},
			comparator: '>',
			threshold: '80'
		},
		severity: 'warn',
		for_duration_secs: 60
	},
	{
		id: 'mem-pressure',
		title: 'Memory pressure',
		summary: 'Fires when little memory remains available.',
		parts: {
			namespace: 'memory',
			field: 'available_bytes',
			labels: {},
			comparator: '<',
			threshold: '524288000'
		},
		severity: 'warn',
		for_duration_secs: 60
	},
	{
		id: 'disk-full',
		title: 'Disk filling up',
		summary: 'Per-mount alert; pick a mount and threshold (bytes used).',
		parts: {
			namespace: 'disk',
			field: 'used_bytes',
			labels: { mount_point: '' },
			comparator: '>',
			threshold: '750000000000'
		},
		severity: 'crit',
		for_duration_secs: 300
	},
	{
		id: 'inode-full',
		title: 'Inode usage high (Linux)',
		summary: 'Files can outrun bytes on busy mounts.',
		parts: {
			namespace: 'disk',
			field: 'inode_used_percent',
			labels: { mount_point: '' },
			comparator: '>',
			threshold: '90'
		},
		severity: 'warn',
		for_duration_secs: 60
	},
	{
		id: 'swap-active',
		title: 'Swap activity',
		summary: 'Pages swapping in indicates thrashing.',
		parts: {
			namespace: 'memory',
			field: 'swap_in_pages_per_sec',
			labels: {},
			comparator: '>',
			threshold: '100'
		},
		severity: 'warn',
		for_duration_secs: 30
	},
	{
		id: 'load-high',
		title: 'Load average high',
		summary: '1-minute load over the threshold (tune to your core count).',
		parts: { namespace: 'cpu', field: 'load_1m', labels: {}, comparator: '>', threshold: '8' },
		severity: 'warn',
		for_duration_secs: 60
	},
	{
		id: 'pressure-cpu',
		title: 'CPU pressure (PSI)',
		summary: 'Linux 4.20+: at least one task stalled waiting for CPU.',
		parts: {
			namespace: 'pressure',
			field: 'some_avg60',
			labels: { resource: 'cpu' },
			comparator: '>',
			threshold: '10'
		},
		severity: 'warn',
		for_duration_secs: 60
	},
	{
		id: 'service-down',
		title: 'Service down',
		summary: 'Alerts when a specific systemd/SCM unit is not Running.',
		parts: {
			namespace: 'service',
			field: 'up',
			labels: { unit: '' },
			comparator: '==',
			threshold: '0'
		},
		severity: 'crit',
		for_duration_secs: 30
	}
];

/** Find the metric value-type for a built expression, used to choose between
 *  number-input and boolean-style controls in the form. */
export function metricTypeOf(
	schema: AlertsSchemaResponse | null,
	namespace: string,
	field: string
): 'float' | 'int' | 'bool' | null {
	const ns: NamespaceSchema | undefined = schema?.namespaces.find((n) => n.name === namespace);
	if (!ns) return null;
	const m = ns.metrics.find((mm) => mm.name === field);
	if (!m) return null;
	return (m.value_type as 'float' | 'int' | 'bool') ?? null;
}
