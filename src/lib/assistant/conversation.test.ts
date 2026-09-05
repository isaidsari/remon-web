import { describe, expect, it } from 'bun:test';
import {
	deriveTitle,
	overflowing,
	sortByRecent,
	toMarkdown,
	MAX_CONVERSATIONS,
	type Conversation
} from './conversation';

function conv(partial: Partial<Conversation> = {}): Conversation {
	return {
		id: 'c1',
		serverId: 's1',
		title: 'why is it slow',
		createdAt: Date.UTC(2026, 0, 2, 3, 4, 5),
		updatedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
		turns: [{ question: 'why is it slow', answer: 'cpu is at 90%' }],
		...partial
	};
}

describe('deriveTitle', () => {
	it('uses the question as written when it is short', () => {
		expect(deriveTitle('why is it slow')).toBe('why is it slow');
	});

	it('collapses newlines and runs of spaces onto one line', () => {
		expect(deriveTitle('  why   is\n\nit slow  ')).toBe('why is it slow');
	});

	it('truncates a long question with an ellipsis', () => {
		const title = deriveTitle('x'.repeat(200));
		expect(title.length).toBe(60);
		expect(title.endsWith('…')).toBe(true);
	});

	it('does not leave a space before the ellipsis', () => {
		const title = deriveTitle(`${'a'.repeat(58)} tail`);
		expect(title).toBe(`${'a'.repeat(58)}…`);
	});

	it('gives an empty title for a blank question', () => {
		expect(deriveTitle('   \n ')).toBe('');
	});
});

describe('sortByRecent', () => {
	it('puts the newest first', () => {
		const out = sortByRecent([{ updatedAt: 1 }, { updatedAt: 3 }, { updatedAt: 2 }]);
		expect(out.map((i) => i.updatedAt)).toEqual([3, 2, 1]);
	});

	it('leaves the input untouched', () => {
		const input = [{ updatedAt: 1 }, { updatedAt: 2 }];
		sortByRecent(input);
		expect(input.map((i) => i.updatedAt)).toEqual([1, 2]);
	});
});

describe('overflowing', () => {
	it('returns nothing while under the cap', () => {
		expect(overflowing([{ updatedAt: 1 }, { updatedAt: 2 }], 5)).toEqual([]);
	});

	it('returns nothing when exactly at the cap', () => {
		expect(overflowing([{ updatedAt: 1 }, { updatedAt: 2 }], 2)).toEqual([]);
	});

	it('drops the oldest past the cap', () => {
		const out = overflowing([{ updatedAt: 5 }, { updatedAt: 1 }, { updatedAt: 3 }], 2);
		expect(out.map((i) => i.updatedAt)).toEqual([1]);
	});

	it('defaults to the shared maximum', () => {
		const many = Array.from({ length: MAX_CONVERSATIONS + 3 }, (_, i) => ({ updatedAt: i }));
		expect(overflowing(many)).toHaveLength(3);
	});
});

describe('toMarkdown', () => {
	it('leads with the title', () => {
		expect(toMarkdown(conv()).startsWith('# why is it slow\n')).toBe(true);
	});

	it('writes each question as a heading and the answer under it', () => {
		const md = toMarkdown(conv());
		expect(md).toContain('## why is it slow');
		expect(md).toContain('cpu is at 90%');
	});

	it('quotes a failed turn instead of printing an empty answer', () => {
		const md = toMarkdown(
			conv({ turns: [{ question: 'q', answer: '', error: 'daemon unreachable' }] })
		);
		expect(md).toContain('> daemon unreachable');
	});

	it('ends with exactly one newline', () => {
		const md = toMarkdown(conv());
		expect(md.endsWith('\n')).toBe(true);
		expect(md.endsWith('\n\n')).toBe(false);
	});

	it('falls back to a name when the title is empty', () => {
		expect(toMarkdown(conv({ title: '' })).startsWith('# remon')).toBe(true);
	});
});
