/// <reference lib="WebWorker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { sharedLocale, showBadge, trackFiring } from './lib/utils/push-cache';
import { renderPush, type PushPayload } from './lib/utils/push-render';

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
	let data: PushPayload | null = null;
	try {
		data = event.data?.json() ?? null;
	} catch {
		// shown as a bare notice below
	}
	event.waitUntil(
		(async () => {
			// A push must always show something, or the browser shows its own notice.
			if (!data?.key) {
				await self.registration.showNotification('remon', { badge: '/badge-96.png' });
				return;
			}
			const { title, options, firing } = renderPush(data, await sharedLocale());
			await self.registration.showNotification(title, options);
			if (!firing) return;
			try {
				await showBadge(self.navigator, await trackFiring(firing.id, firing.on));
			} catch {
				// Badging is optional; the notification itself already went out.
			}
		})()
	);
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
