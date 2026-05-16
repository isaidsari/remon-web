import type { Connection } from '$lib/stores/connections.svelte';

export type LiveTone = 'online' | 'connecting' | 'offline' | 'idle' | 'warning';

// Single source of truth for the badge tone shown on a server card.
// ServerCard renders the badge; +page.svelte counts cards by tone — they
// must agree, otherwise the summary pills disagree with the card pills.
export function connectionTone(conn: Connection): LiveTone {
	if (!conn.isAuthenticated) {
		return conn.status === 'authenticating' ? 'connecting' : 'offline';
	}
	const s = conn.live.status;
	if (s === 'open') return 'online';
	if (s === 'connecting' || s === 'reconnecting') return 'connecting';
	// 'idle' (not yet acquired) or 'closed' (released) — authenticated and
	// reachable; stream starts when a component acquires it.
	return 'idle';
}
