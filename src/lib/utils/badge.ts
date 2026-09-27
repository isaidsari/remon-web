// Home-screen badge: alerts fired since the app was last in view (pushes carry no alert id to pair resolves).

export const BADGE_CACHE = 'remon-badge';
const BADGE_KEY = '/__badge-count';

/** The window's navigator and the worker's both have these where badging exists. */
interface BadgeNavigator {
	setAppBadge?: (n?: number) => Promise<void>;
	clearAppBadge?: () => Promise<void>;
}

export async function readBadgeCount(): Promise<number> {
	const res = await (await caches.open(BADGE_CACHE)).match(BADGE_KEY);
	const n = res ? Number(await res.text()) : 0;
	return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function writeBadgeCount(n: number): Promise<void> {
	await (await caches.open(BADGE_CACHE)).put(BADGE_KEY, new Response(String(n)));
}

export async function showBadge(nav: BadgeNavigator, n: number): Promise<void> {
	if (n > 0) await nav.setAppBadge?.(n);
	else await nav.clearAppBadge?.();
}

/** Called by the page whenever it becomes visible. */
export async function clearBadge(): Promise<void> {
	if (typeof caches === 'undefined') return;
	try {
		await caches.delete(BADGE_CACHE);
		await showBadge(navigator, 0);
	} catch {
		// Unsupported or blocked storage; the badge is a nicety.
	}
}
