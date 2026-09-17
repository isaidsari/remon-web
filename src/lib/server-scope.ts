import { getContext, setContext } from 'svelte';
import type { Connection } from '$lib/stores/connections.svelte';
import type { ServerProfile } from '$lib/types/profile';

/** The server a `/servers/[id]` page belongs to. The layout provides it and
 *  guarantees a profile and a signed-in connection before a page renders. */
export interface ServerScope {
	readonly id: string;
	readonly profile: ServerProfile;
	readonly conn: Connection;
}

const KEY = Symbol('server-scope');

export function provideServer(scope: ServerScope): void {
	setContext(KEY, scope);
}

/** Read with `let { conn } = $derived(useServer())` so a switch between
 *  servers flows through. */
export function useServer(): ServerScope {
	const scope = getContext<ServerScope | undefined>(KEY);
	if (!scope) throw new Error('useServer() called outside /servers/[id]');
	return scope;
}
