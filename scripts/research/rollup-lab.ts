// Run from remon-web: bun scripts/research/rollup-lab.ts
// Synthetic research fixtures; does not open or modify the application database.
import { Database } from 'bun:sqlite';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

type Summary = { min: number | null; max: number | null; sum: number; count: number };
const empty = (): Summary => ({ min: null, max: null, sum: 0, count: 0 });
function merge(a: Summary, b: Summary): Summary {
	return {
		min: a.min === null ? b.min : b.min === null ? a.min : Math.min(a.min, b.min),
		max: a.max === null ? b.max : b.max === null ? a.max : Math.max(a.max, b.max),
		sum: a.sum + b.sum,
		count: a.count + b.count
	};
}
function summarize(values: (number | null)[]): Summary {
	return values.reduce<Summary>(
		(a, x) => (x === null ? a : merge(a, { min: x, max: x, sum: x, count: 1 })),
		empty()
	);
}
const mean = (s: Summary) => (s.count ? s.sum / s.count : null);
const chunks = <T>(xs: T[], n: number): T[][] =>
	Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));
const raw = Array.from({ length: 1800 }, (_, i) => (i === 450 ? 100 : 10));
const minute = chunks(raw, 30).map(summarize);
const fiveMinute = chunks(minute, 5).map((xs) => xs.reduce(merge, empty()));
const hour = fiveMinute.reduce(merge, empty());
assert.deepEqual(hour, summarize(raw));
assert.equal(mean(hour), 10.05);
const ordered = raw.toSorted((a, b) => a - b);
const p99 = ordered[Math.ceil(ordered.length * 0.99) - 1];
assert.equal(p99, 10);

// Mirror the current SQL expressions, including per-row sample_count and casts.
const db = new Database(':memory:');
db.exec('CREATE TABLE samples (bucket INTEGER, value REAL, sample_count INTEGER)');
const insert = db.prepare('INSERT INTO samples VALUES (?, ?, NULL)');
db.transaction(() => {
	for (let i = 0; i < 30; i++) insert.run(0, i === 0 ? 100 : null);
	for (let i = 0; i < 30; i++) insert.run(1, 0);
})();
const weighted =
	'SUM(value * COALESCE(sample_count, 1)) / NULLIF(SUM(CASE WHEN value IS NULL THEN 0 ELSE COALESCE(sample_count, 1) END), 0)';
const nullCase = db
	.query<{ value: number }, []>(
		`WITH child AS (SELECT ${weighted} AS value, COUNT(*) AS sample_count FROM samples GROUP BY bucket) SELECT ${weighted} AS value FROM child`
	)
	.get()!;
assert.equal(nullCase.value, 50);
const correctNull = mean(
	summarize([100, ...Array<number | null>(29).fill(null), ...Array<number>(30).fill(0)])
);
assert.equal(correctNull, 100 / 31);
db.exec('DELETE FROM samples');
for (const [i, x] of [0, 1, 1, 2].entries()) insert.run(Math.floor(i / 2), x);
const integerCase = db
	.query<{ value: number }, []>(
		`WITH child AS (SELECT CAST(${weighted} AS INTEGER) AS value, COUNT(*) AS sample_count FROM samples GROUP BY bucket) SELECT CAST(${weighted} AS INTEGER) AS value FROM child`
	)
	.get()!;
assert.equal(integerCase.value, 0);
assert.equal(mean(summarize([0, 1, 1, 2])), 1);
const counters = [900, 1000, 10, 30];
const observedIncrease = counters
	.slice(1)
	.reduce((sum, value, i) => sum + (value >= counters[i] ? value - counters[i] : value), 0);
assert.equal(observedIncrease, 130);
assert.equal(Math.max(...counters), 1000);
assert.equal(counters.at(-1), 30);
assert.equal(Math.max(100 + 0, 0 + 100), 100);
assert.equal(Math.max(100, 0) + Math.max(0, 100), 200);

// Partition invariance with missing values, unequal partitions, and signed gauges.
let seed = 7;
for (let trial = 0; trial < 200; trial++) {
	const values = Array.from({ length: 1 + trial }, () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed % 7 === 0 ? null : (seed % 2001) - 1000;
	});
	assert.deepEqual(
		chunks(values, 1 + (trial % 17))
			.map(summarize)
			.reduce(merge, empty()),
		summarize(values)
	);
}
db.close();

// Allocated SQLite pages, synthetic 11-REAL-field wide table, six enriched fields.
// Not a production database size forecast: no WAL, churn, secondary indexes or compression.
const tiers = [
	['raw', 43200, 2],
	['1m', 10080, 60],
	['5m', 8640, 300],
	['1h', 8760, 3600]
] as const;
const storage = [];
for (const extra of [0, 2, 4, 6]) {
	const bench = new Database(':memory:');
	bench.exec('PRAGMA page_size=4096');
	const baseColumns = Array.from({ length: 11 }, (_, i) => `v${i} REAL`);
	const extraColumns = Array.from({ length: 6 }, (_, i) =>
		['min', 'max', 'sum', 'count', 'min_ts', 'max_ts']
			.slice(0, extra)
			.map((s) => `v${i}_${s} ${s === 'count' || s.endsWith('_ts') ? 'INTEGER' : 'REAL'}`)
	).flat();
	bench.exec(
		`CREATE TABLE metrics (resolution TEXT, timestamp INTEGER, ${[...baseColumns, ...extraColumns].join(',')}, sample_count INTEGER, PRIMARY KEY(resolution,timestamp)) WITHOUT ROWID`
	);
	const put = bench.prepare(
		`INSERT INTO metrics VALUES (${Array(14 + extraColumns.length)
			.fill('?')
			.join(',')})`
	);
	bench.transaction(() => {
		for (const [tier, rows, seconds] of tiers) {
			for (let row = 0; row < rows; row++) {
				const ts = 1700000000 + row * seconds;
				const values = Array.from(
					{ length: 11 },
					(_, i) => 10.125 + ((row * 17 + i * 13) % 900) / 10
				);
				const extensions = values
					.slice(0, 6)
					.flatMap((v) =>
						tier === 'raw'
							? Array(extra).fill(null)
							: [v - 1.25, v + 2.25, (v * seconds) / 2, seconds / 2, ts, ts + seconds - 2].slice(
									0,
									extra
								)
					);
				put.run(tier, ts, ...values, ...extensions, tier === 'raw' ? null : seconds / 2);
			}
		}
	})();
	const pages = bench.query<{ page_count: number }, []>('PRAGMA page_count').get()!.page_count;
	storage.push({
		extraStatsPerField: extra,
		trackedFields: 6,
		rows: 70680,
		allocatedBytes: pages * 4096
	});
	bench.close();
}
const output = new URL('../../docs/research/', import.meta.url);
await mkdir(output, { recursive: true });
const result = {
	bun: Bun.version,
	spike: {
		rawMax: 100,
		maximumMinuteMean: Math.max(...minute.map((s) => mean(s)!)),
		maximumFiveMinuteMean: Math.max(...fiveMinute.map((s) => mean(s)!)),
		hourMean: mean(hour),
		hourMax: hour.max,
		hourP99: p99
	},
	nullWeights: { current: nullCase.value, correct: correctNull },
	integerTruncation: { current: integerCase.value, correct: 1 },
	counter: { max: 1000, last: 30, observedIncrease },
	network: { sumOfMaxima: 200, maximumOfSum: 100 },
	partitionTrials: 200,
	storage
};
await writeFile(
	new URL('rollup-lab-results.json', output),
	JSON.stringify(result, null, '\t') + '\n'
);
await writeFile(
	new URL('rollup-storage.csv', output),
	'extra_stats_per_field,tracked_fields,rows,allocated_bytes\n' +
		storage
			.map((r) => [r.extraStatsPerField, r.trackedFields, r.rows, r.allocatedBytes].join(','))
			.join('\n') +
		'\n'
);
console.log(JSON.stringify(result, null, 2));
