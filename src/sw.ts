/// <reference lib="WebWorker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & typeof globalThis;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// vite-plugin-pwa sends this when the user confirms a reload
self.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
	let data: Record<string, string>;
	try {
		data = event.data ? event.data.json() : {};
	} catch {
		data = { title: 'remon', body: event.data ? event.data.text() : '' };
	}
	const title = data.title || 'remon';
	const isCrit = data.severity === 'crit';
	// Pick the panel icon by state so the OS notification is legible at a
	// glance: a resolved event is calm (green), a fired one is red (crit) or
	// amber (warn). Falls back to the crit icon for an unknown severity — a
	// missing/mislabelled alert should look loud, not quiet.
	const icon =
		data.event === 'resolved'
			? '/notify-ok.png'
			: data.severity === 'warn'
				? '/notify-warn.png'
				: '/notify-crit.png';
	const options: NotificationOptions = {
		body: data.body || '',
		icon,
		badge: '/badge-96.png',
		tag: data.tag,
		data,
		requireInteraction: isCrit
	};
	event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const target = (event.notification.data?.url as string | undefined) ?? '/servers';
	event.waitUntil(
		(async () => {
			const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
			for (const client of wins) {
				if (client.url.endsWith(target) && 'focus' in client) return client.focus();
			}
			for (const client of wins) {
				if ('focus' in client) {
					await client.focus();
					if ('navigate' in client) await (client as WindowClient).navigate(target);
					return;
				}
			}
			if (self.clients.openWindow) await self.clients.openWindow(target);
		})()
	);
});
