import type { ApiClient } from '$lib/api/client';
import { vault } from '$lib/vault/store.svelte';
import type { EncryptedBlob } from '$lib/vault/crypto';

// A browser holds one push subscription per service worker, so this browser
// makes its own VAPID key, subscribes once with it, and registers that one
// subscription with every server it wants alerts from.

export type MinSeverity = 'warn' | 'crit';

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

// ---- this browser's VAPID key ----

const KEY_STORAGE = 'remon.push.key';

interface DeviceKey {
	/** Uncompressed P-256 point, base64url: the subscription's applicationServerKey. */
	publicKey: string;
	/** PKCS#8 PEM, handed to each server so it can sign for this browser. */
	privatePem: string;
}

function toPem(pkcs8: ArrayBuffer): string {
	const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
	const lines = b64.match(/.{1,64}/g) ?? [];
	return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----\n`;
}

/** Sealed under the vault's key; only readable while it's open, as is every server. */
async function deviceKey(): Promise<DeviceKey> {
	const raw = localStorage.getItem(KEY_STORAGE);
	if (raw) return vault.unseal<DeviceKey>(JSON.parse(raw) as EncryptedBlob);
	const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign',
		'verify'
	]);
	const key: DeviceKey = {
		publicKey: arrayBufferToBase64Url(await crypto.subtle.exportKey('raw', pair.publicKey)),
		privatePem: toPem(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
	};
	localStorage.setItem(KEY_STORAGE, JSON.stringify(await vault.seal(key)));
	return key;
}

// ---- which servers this browser gets alerts from ----

const SERVERS_STORAGE = 'remon.push.servers';

export interface Registration {
	/** Endpoint the server was last given; a mismatch means it needs the new one. */
	endpoint: string;
	minSeverity: MinSeverity | null;
}

type Registry = Record<string, Registration>;

function readRegistry(): Registry {
	try {
		const raw = localStorage.getItem(SERVERS_STORAGE);
		return raw ? (JSON.parse(raw) as Registry) : {};
	} catch {
		return {};
	}
}

function writeRegistry(reg: Registry): void {
	try {
		localStorage.setItem(SERVERS_STORAGE, JSON.stringify(reg));
	} catch {
		// non-fatal: the next sync re-registers
	}
}

export function pushRegistration(profileId: string): Registration | null {
	return readRegistry()[profileId] ?? null;
}

// ---- subscription ----

function sameKey(sub: PushSubscription, publicKey: string): boolean {
	const k = sub.options.applicationServerKey;
	return k != null && arrayBufferToBase64Url(k) === publicKey;
}

/** The browser's subscription, made with its own key; replaces one made with any other. */
async function ensureSubscription(key: DeviceKey): Promise<PushSubscription> {
	if (Notification.permission === 'denied') {
		throw new Error(
			"Notifications are blocked. Allow them in this site's browser settings and try again."
		);
	}
	if (Notification.permission === 'default') {
		const granted = await Notification.requestPermission();
		if (granted !== 'granted') throw new Error('Notification permission was not granted.');
	}
	const reg = await navigator.serviceWorker.ready;
	const current = await reg.pushManager.getSubscription();
	if (current && sameKey(current, key.publicKey)) return current;
	if (current) await current.unsubscribe();
	return reg.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: urlBase64ToUint8Array(key.publicKey)
	});
}

async function register(
	client: ApiClient,
	profileId: string,
	sub: PushSubscription,
	key: DeviceKey,
	minSeverity: MinSeverity | null
): Promise<void> {
	const p256dh = sub.getKey('p256dh');
	const auth = sub.getKey('auth');
	if (!p256dh || !auth) {
		throw new Error('Browser subscription is missing required p256dh / auth keys');
	}
	await client.subscribePush({
		endpoint: sub.endpoint,
		p256dh: arrayBufferToBase64Url(p256dh),
		auth: arrayBufferToBase64Url(auth),
		vapid_private_key: key.privatePem,
		ref: profileId,
		min_severity: minSeverity
	});
}

/**
 * Start (or retune) alerts from one server. `clientFor` reaches the other
 * servers when the subscription had to be remade and they need the new one.
 */
export async function enableServerPush(
	client: ApiClient,
	profileId: string,
	minSeverity: MinSeverity | null,
	clientFor: (profileId: string) => ApiClient | null
): Promise<void> {
	const key = await deviceKey();
	const sub = await ensureSubscription(key);
	await register(client, profileId, sub, key, minSeverity);

	const registry = readRegistry();
	registry[profileId] = { endpoint: sub.endpoint, minSeverity };
	writeRegistry(registry);
	await syncOthers(sub.endpoint, profileId, clientFor);
}

export async function disableServerPush(client: ApiClient, profileId: string): Promise<void> {
	await client.unsubscribePush();
	const registry = readRegistry();
	delete registry[profileId];
	writeRegistry(registry);
	if (Object.keys(registry).length === 0) await (await getCurrentSubscription())?.unsubscribe();
}

/** Give a server the current subscription if it was registered with an older one. */
export async function syncServerPush(client: ApiClient, profileId: string): Promise<void> {
	const entry = readRegistry()[profileId];
	if (!entry || !isPushSupported() || Notification.permission !== 'granted') return;
	const key = await deviceKey();
	const sub = await getCurrentSubscription();
	if (!sub || !sameKey(sub, key.publicKey) || entry.endpoint === sub.endpoint) return;
	await register(client, profileId, sub, key, entry.minSeverity);
	const registry = readRegistry();
	registry[profileId] = { ...entry, endpoint: sub.endpoint };
	writeRegistry(registry);
}

async function syncOthers(
	endpoint: string,
	except: string,
	clientFor: (profileId: string) => ApiClient | null
): Promise<void> {
	for (const [id, entry] of Object.entries(readRegistry())) {
		if (id === except || entry.endpoint === endpoint) continue;
		const client = clientFor(id);
		// Unreachable now: syncServerPush retries when that server signs in.
		if (client) await syncServerPush(client, id).catch(() => {});
	}
}
