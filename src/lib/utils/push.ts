// Uint8Array<ArrayBuffer> return type is required for PushManager.subscribe's
// applicationServerKey — TS 5+ widens the default to ArrayBufferLike which
// includes SharedArrayBuffer, and the browser API rejects that.
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
	/** The subscription's endpoint at the time it was recorded — lets a
	 *  caller confirm the live subscription still matches what's stored
	 *  here, rather than trusting a serverId that could be stale. */
	endpoint: string;
}

/**
 * Every server profile mints its own VAPID keypair, but a browser allows
 * exactly one PushManager subscription per service-worker registration —
 * and remon-web registers one SW for the whole app, shared across every
 * paired server. So "push is enabled" is a per-browser fact, not a
 * per-server one: subscribing a second server silently invalidates (or
 * outright fails to replace) the first. This records which paired server
 * the current subscription actually belongs to, so each server's settings
 * page can tell "enabled here" apart from "enabled for a different server".
 */
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
