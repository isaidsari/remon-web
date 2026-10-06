import { describe, expect, it } from 'bun:test';
import { clipUtf8, replayHistory, MAX_REPLAY_ANSWER_BYTES, MAX_REPLAY_TURNS } from './replay';

const bytes = (s: string) => new TextEncoder().encode(s).length;

describe('clipUtf8', () => {
	it('leaves short strings alone', () => {
		expect(clipUtf8('kısa', 10)).toBe('kısa');
	});

	it('never splits a character', () => {
		// "ı" is two bytes: a cut through it backs off to before it.
		expect(clipUtf8('kısa', 2)).toBe('k');
		expect(clipUtf8('kısa', 3)).toBe('kı');
		// A four-byte emoji either fits whole or not at all.
		expect(clipUtf8('a😀', 4)).toBe('a');
	});
});

describe('replayHistory', () => {
	it('keeps the most recent turns', () => {
		const turns = Array.from({ length: 20 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }));
		const out = replayHistory(turns);
		expect(out).toHaveLength(MAX_REPLAY_TURNS);
		expect(out[0].question).toBe('q8');
		expect(out.at(-1)?.question).toBe('q19');
	});

	it('clips long answers to what the daemon keeps', () => {
		const [turn] = replayHistory([{ question: 'q', answer: 'ş'.repeat(5000) }]);
		expect(bytes(turn.answer)).toBeLessThanOrEqual(MAX_REPLAY_ANSWER_BYTES);
		expect(turn.answer.startsWith('şş')).toBe(true);
	});
});
