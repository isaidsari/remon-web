// The conversation model and everything that can be decided without storage.
// Kept free of the vault so it stays testable outside a browser.

/** Kept per server; the oldest fall off once a profile passes this. */
export const MAX_CONVERSATIONS = 50;

/** One finished exchange. Mirrors the page's Entry minus everything transient. */
export interface StoredTurn {
	question: string;
	answer: string;
	error?: string | null;
}

export interface Conversation {
	id: string;
	serverId: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	turns: StoredTurn[];
}

const TITLE_MAX = 60;

/** First question, collapsed to one line, as the conversation's name. */
export function deriveTitle(question: string): string {
	const flat = question.replace(/\s+/g, ' ').trim();
	if (flat.length === 0) return '';
	return flat.length <= TITLE_MAX ? flat : `${flat.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

/** Newest first. */
export function sortByRecent<T extends { updatedAt: number }>(items: T[]): T[] {
	return [...items].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Everything past the cap, oldest first — what a save should delete. */
export function overflowing<T extends { updatedAt: number }>(
	items: T[],
	max = MAX_CONVERSATIONS
): T[] {
	if (items.length <= max) return [];
	return sortByRecent(items).slice(max);
}

/** Portable transcript: readable pasted anywhere. */
export function toMarkdown(conversation: Conversation): string {
	const when = new Date(conversation.createdAt).toISOString();
	const lines = [`# ${conversation.title || 'remon'}`, '', `_${when}_`, ''];
	for (const turn of conversation.turns) {
		lines.push(`## ${turn.question}`, '');
		if (turn.error) lines.push(`> ${turn.error}`, '');
		else lines.push(turn.answer, '');
	}
	return lines.join('\n').trimEnd() + '\n';
}
