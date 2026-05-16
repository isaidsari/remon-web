self.addEventListener('install', () => {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
	let data = {};
	try {
		data = event.data ? event.data.json() : {};
	} catch (_e) {
		data = { title: 'remon', body: event.data ? event.data.text() : '' };
	}
	const title = data.title || 'remon';
	const isCrit = data.severity === 'crit';
	const options = {
		body: data.body || '',
		badge: '/badge-96.png',
		tag: data.tag || undefined,
		data,
		requireInteraction: isCrit
	};
	event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const target = (event.notification.data && event.notification.data.url) || '/servers';
	event.waitUntil(
		(async () => {
			const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
			for (const client of wins) {
				if (client.url.endsWith(target) && 'focus' in client) {
					return client.focus();
				}
			}
			for (const client of wins) {
				if ('focus' in client) {
					await client.focus();
					if ('navigate' in client) await client.navigate(target);
					return;
				}
			}
			if (self.clients.openWindow) {
				await self.clients.openWindow(target);
			}
		})()
	);
});
