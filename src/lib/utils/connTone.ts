import type { Connection } from '$lib/stores/connections.svelte';

export type LiveTone = 'online' | 'connecting' | 'offline' | 'idle' | 'warning';

/**
 * Reachability only, for a dot that sits beside a server's name. The live
 * stream is reference-counted — pages that need it acquire it — so folding its
 * state in here would grey the dot out on every page that simply doesn't stream
 * and read as "something is wrong" when nothing is.
 */
export function sessionTone(conn: Connection): LiveTone {
	if (conn.isAuthenticated) return 'online';
	return conn.status === 'authenticating' ? 'connecting' : 'offline';
}

// Shared so the card badge and the summary pills that count by tone agree.
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
