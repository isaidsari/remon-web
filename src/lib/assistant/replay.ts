// What the daemon keeps of a replayed conversation (remon-server
// src/assistant/mod.rs). It clips only after reading the body, so sending
// more buys nothing and can push a long conversation past its size limit.

import type { AssistantHistoryTurn } from '$lib/types/api';

export const MAX_REPLAY_TURNS = 12;
export const MAX_REPLAY_QUESTION_BYTES = 2000;
export const MAX_REPLAY_ANSWER_BYTES = 4000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** `s` cut to at most `max` UTF-8 bytes without splitting a character. */
export function clipUtf8(s: string, max: number): string {
	const bytes = encoder.encode(s);
	if (bytes.length <= max) return s;
	let end = max;
	// Back off continuation bytes (10xxxxxx) to the start of a character.
	while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
	return decoder.decode(bytes.subarray(0, end));
}

/** The most recent turns, each clipped the way the daemon would. */
export function replayHistory(turns: AssistantHistoryTurn[]): AssistantHistoryTurn[] {
	return turns.slice(-MAX_REPLAY_TURNS).map((t) => ({
		question: clipUtf8(t.question, MAX_REPLAY_QUESTION_BYTES),
		answer: clipUtf8(t.answer, MAX_REPLAY_ANSWER_BYTES)
	}));
}
