// The explicit Uint8Array<ArrayBuffer> matters: the default widens to
// ArrayBufferLike, which applicationServerKey rejects.
function urlBase64ToUint8Array(base64UrlString: string): Uint8Array<ArrayBuffer> {
	const padding = '='.repeat((4 - (base64UrlString.length % 4)) % 4);
	const base64 = (base64UrlString + padding).replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(base64);
	const out = new Uint8Array(new ArrayBuffer(raw.length));
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// iOS Safari only enables PushManager after "Add to Home Screen"
export function isPushSupported(): boolean {
	return (
		typeof window !== 'undefined' &&
		'serviceWorker' in navigator &&
		'PushManager' in window &&
		'Notification' in window
	);
}

export function notificationPermission(): NotificationPermission {
	if (typeof window === 'undefined' || !('Notification' in window)) return 'default';
	return Notification.permission;
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
	if (!isPushSupported()) return null;
	const reg = await navigator.serviceWorker.ready;
	return reg.pushManager.getSubscription();
}

export function subscriptionToPayload(sub: PushSubscription): {
	endpoint: string;
	p256dh: string;
	auth: string;
} {
	const p256dh = sub.getKey('p256dh');
	const auth = sub.getKey('auth');
	if (!p256dh || !auth) {
		throw new Error('Browser subscription is missing required p256dh / auth keys');
	}
	return {
		endpoint: sub.endpoint,
		p256dh: arrayBufferToBase64Url(p256dh),
		auth: arrayBufferToBase64Url(auth)
	};
}

export async function subscribeToPush(vapidPublicKey: string): Promise<{
	endpoint: string;
	p256dh: string;
	auth: string;
}> {
	if (!isPushSupported()) {
		throw new Error("Push notifications aren't supported in this browser.");
	}
	if (Notification.permission === 'denied') {
		throw new Error(
			"Notifications are blocked. Allow them in this site's browser settings and try again."
		);
	}
	if (Notification.permission === 'default') {
		const granted = await Notification.requestPermission();
		if (granted !== 'granted') {
			throw new Error('Notification permission was not granted.');
		}
	}
	const reg = await navigator.serviceWorker.ready;
	const sub = await reg.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
	});
	return subscriptionToPayload(sub);
}

export async function unsubscribeLocal(): Promise<void> {
	const sub = await getCurrentSubscription();
	if (sub) await sub.unsubscribe();
}

const OWNER_KEY = 'remon.push.owner';

export interface PushOwner {
	serverId: string;
	/** Endpoint as recorded, so a caller can tell a stale serverId apart. */
	endpoint: string;
}

/** A browser allows one push subscription per SW registration, and there is one
 *  SW for every paired server — so "push is enabled" is a per-browser fact.
 *  This records which server owns the current one. */
export function getPushOwner(): PushOwner | null {
	try {
		const raw = localStorage.getItem(OWNER_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<PushOwner>;
		return typeof parsed.serverId === 'string' && typeof parsed.endpoint === 'string'
			? (parsed as PushOwner)
			: null;
	} catch {
		return null;
	}
}

export function setPushOwner(owner: PushOwner): void {
	try {
		localStorage.setItem(OWNER_KEY, JSON.stringify(owner));
	} catch {
		// non-fatal — worst case a later ownership check falls back to "other/unknown"
	}
}

export function clearPushOwner(): void {
	try {
		localStorage.removeItem(OWNER_KEY);
	} catch {
		// nothing to clean up
	}
}
