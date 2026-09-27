// Home-screen badge: how many alerts are firing across every server that
// pushes here. The service worker adds a key on fire and drops it on resolve;
// the page prunes a server's keys when that server reports nothing firing.

const CACHE = 'remon-push';
const FIRING_KEY = '/__firing';
const LANG_KEY = '/__lang';

/** The window's navigator and the worker's both have these where badging exists. */
interface BadgeNavigator {
	setAppBadge?: (n?: number) => Promise<void>;
	clearAppBadge?: () => Promise<void>;
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
	try {
		const res = await (await caches.open(CACHE)).match(key);
		return res ? ((await res.json()) as T) : fallback;
	} catch {
		return fallback;
	}
}

async function writeJson(key: string, value: unknown): Promise<void> {
	await (await caches.open(CACHE)).put(key, new Response(JSON.stringify(value)));
}

export async function showBadge(nav: BadgeNavigator, n: number): Promise<void> {
	if (n > 0) await nav.setAppBadge?.(n);
	else await nav.clearAppBadge?.();
}

/** Adds or drops one firing alert; returns how many are firing now. */
export async function trackFiring(id: string, firing: boolean): Promise<number> {
	const set = new Set(await readJson<string[]>(FIRING_KEY, []));
	if (firing) set.add(id);
	else set.delete(id);
	await writeJson(FIRING_KEY, [...set]);
	return set.size;
}

/** A server says nothing is firing: forget its keys, in case a resolve never arrived. */
export async function clearServerFiring(ref: string): Promise<void> {
	if (typeof caches === 'undefined') return;
	try {
		const all = await readJson<string[]>(FIRING_KEY, []);
		const kept = all.filter((id) => !id.startsWith(`${ref}|`));
		if (kept.length === all.length) return;
		await writeJson(FIRING_KEY, kept);
		await showBadge(navigator, kept.length);
	} catch {
		// Unsupported or blocked storage; the badge is a nicety.
	}
}

/** The worker has no localStorage, so the page leaves the UI language here. */
export async function shareLocale(locale: string): Promise<void> {
	if (typeof caches === 'undefined') return;
	try {
		await writeJson(LANG_KEY, locale);
	} catch {
		// falls back to English in notifications
	}
}

export async function sharedLocale(): Promise<string> {
	return readJson<string>(LANG_KEY, 'en');
}
