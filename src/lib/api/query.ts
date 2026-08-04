import { QueryClient } from '@tanstack/svelte-query';
import { ApiError } from './error';

/** Scoped by profile id: the same path means a different host per server. */
export function serverKey(id: string, ...rest: unknown[]): unknown[] {
	return ['server', id, ...rest];
}

export function createQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				// Same window as the ApiClient's own GET cache.
				staleTime: 5_000,
				// Polling is the retry; an auth failure would just burn round-trips.
				retry: false,
				refetchOnWindowFocus: true
			}
		}
	});
}

/** One line to show, whatever the failure was. */
export function queryErrorMessage(e: unknown, fallback: string): string {
	return e instanceof ApiError ? e.userMessage : fallback;
}
