import { QueryClient } from '@tanstack/svelte-query';
import { ApiError } from './error';

/**
 * Every cached entry is scoped by profile id. The app talks to several servers
 * at once and the same path means a different host on each — an unscoped key
 * would hand one server's containers to another's page on navigation.
 */
export function serverKey(id: string, ...rest: unknown[]): unknown[] {
	return ['server', id, ...rest];
}

export function createQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				// Matches the ApiClient's own short GET cache: two components
				// mounting the same query in one screen share a single request,
				// a genuine refetch still gets through.
				staleTime: 5_000,
				// Polling is the retry here. A failed read is retried by the next
				// tick with fresher intent, and an auth-class failure would only
				// burn three round-trips before showing the same message.
				retry: false,
				// A monitoring tab that has been in the background is exactly the
				// one whose numbers are stale when it comes back.
				refetchOnWindowFocus: true
			}
		}
	});
}

/**
 * The daemon speaks in `ApiError`; the UI wants one line to show. Kept here so
 * every query surface reads failures the same way.
 */
export function queryErrorMessage(e: unknown, fallback: string): string {
	return e instanceof ApiError ? e.userMessage : fallback;
}
