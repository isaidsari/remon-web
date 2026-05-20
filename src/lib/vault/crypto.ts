// PBKDF2-SHA256 600k iter + AES-256-GCM. Key non-extractable, IV fresh per encrypt.
export const KDF_ITERATIONS = 600_000;
export const SALT_LENGTH = 16;
export const IV_LENGTH = 12;

export interface EncryptedBlob {
	v: 1;
	kdf: {
		algo: 'PBKDF2-SHA256';
		iter: number;
		salt: string; // base64
	};
	iv: string; // base64
	ct: string; // base64 ciphertext (includes GCM tag)
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
	const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let s = '';
	for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
	return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
	const bin = atob(b64);
	const u8 = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
	return u8;
}

export function randomBytes(length: number): Uint8Array {
	const buf = new Uint8Array(length);
	crypto.getRandomValues(buf);
	return buf;
}

// iter is persisted in the blob so old vaults survive a future iteration-count bump
export async function deriveKey(
	password: string,
	salt: Uint8Array,
	iterations: number = KDF_ITERATIONS
): Promise<CryptoKey> {
	const passKey = await crypto.subtle.importKey(
		'raw',
		enc.encode(password),
		{ name: 'PBKDF2' },
		false,
		['deriveKey']
	);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
		passKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

// Same derivation but extractable — needed only by trustDevice() so the master key
// can be wrapped under the device key. Normal vault use keeps the non-extractable form.
export async function deriveKeyExtractable(
	password: string,
	salt: Uint8Array,
	iterations: number = KDF_ITERATIONS
): Promise<CryptoKey> {
	const passKey = await crypto.subtle.importKey(
		'raw',
		enc.encode(password),
		{ name: 'PBKDF2' },
		false,
		['deriveKey']
	);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
		passKey,
		{ name: 'AES-GCM', length: 256 },
		true,
		['encrypt', 'decrypt']
	);
}

export async function encryptJson<T>(
	key: CryptoKey,
	plaintext: T,
	salt: Uint8Array,
	iterations: number = KDF_ITERATIONS
): Promise<EncryptedBlob> {
	const iv = randomBytes(IV_LENGTH);
	const data = enc.encode(JSON.stringify(plaintext));
	const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, data);
	return {
		v: 1,
		kdf: { algo: 'PBKDF2-SHA256', iter: iterations, salt: toBase64(salt) },
		iv: toBase64(iv),
		ct: toBase64(ct)
	};
}

export async function decryptJson<T>(key: CryptoKey, blob: EncryptedBlob): Promise<T> {
	const iv = fromBase64(blob.iv);
	const ct = fromBase64(blob.ct);
	const plaintextBytes = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: iv as BufferSource },
		key,
		ct as BufferSource
	);
	return JSON.parse(dec.decode(plaintextBytes)) as T;
}

// ─── Device-bound key (for optional auto-unlock) ─────────────────────────────
// A non-extractable AES-GCM CryptoKey persisted in IndexedDB. Used to wrap the
// master vault key when the user opts into "trust this device". The wrapped
// blob lives in localStorage (compact + sync-readable), the key itself only
// in IndexedDB because non-extractable CryptoKeys can't be serialised.

const IDB_NAME = 'remon-web';
const IDB_STORE = 'vault-keys';
const DEVICE_KEY_ID = 'device-key';

export interface WrappedKey {
	v: 1;
	iv: string; // base64
	ct: string; // base64 (wrapped raw key bytes)
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(IDB_NAME, 1);
		req.onupgradeneeded = () => {
			req.result.createObjectStore(IDB_STORE);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function idbGet<T>(key: string): Promise<T | null> {
	return openDb().then(
		(db) =>
			new Promise<T | null>((resolve, reject) => {
				const tx = db.transaction(IDB_STORE, 'readonly');
				const req = tx.objectStore(IDB_STORE).get(key);
				req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
				req.onerror = () => reject(req.error);
			})
	);
}

function idbPut(key: string, value: unknown): Promise<void> {
	return openDb().then(
		(db) =>
			new Promise<void>((resolve, reject) => {
				const tx = db.transaction(IDB_STORE, 'readwrite');
				tx.objectStore(IDB_STORE).put(value, key);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			})
	);
}

function idbDelete(key: string): Promise<void> {
	return openDb().then(
		(db) =>
			new Promise<void>((resolve, reject) => {
				const tx = db.transaction(IDB_STORE, 'readwrite');
				tx.objectStore(IDB_STORE).delete(key);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			})
	);
}

export async function getDeviceKey(): Promise<CryptoKey | null> {
	try {
		return await idbGet<CryptoKey>(DEVICE_KEY_ID);
	} catch {
		return null;
	}
}

export async function getOrCreateDeviceKey(): Promise<CryptoKey> {
	const existing = await getDeviceKey();
	if (existing) return existing;
	const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
		'wrapKey',
		'unwrapKey'
	]);
	await idbPut(DEVICE_KEY_ID, key);
	return key;
}

export async function deleteDeviceKey(): Promise<void> {
	try {
		await idbDelete(DEVICE_KEY_ID);
	} catch {
		/* best-effort */
	}
}

/** Wrap an extractable master CryptoKey under the device key. */
export async function wrapMasterKey(master: CryptoKey, device: CryptoKey): Promise<WrappedKey> {
	const iv = randomBytes(IV_LENGTH);
	const wrapped = await crypto.subtle.wrapKey('raw', master, device, {
		name: 'AES-GCM',
		iv: iv as BufferSource
	});
	return { v: 1, iv: toBase64(iv), ct: toBase64(wrapped) };
}

/** Unwrap a master key from a wrapped blob using the device key. */
export async function unwrapMasterKey(
	wrapped: WrappedKey,
	device: CryptoKey
): Promise<CryptoKey> {
	const iv = fromBase64(wrapped.iv);
	const ct = fromBase64(wrapped.ct);
	return crypto.subtle.unwrapKey(
		'raw',
		ct as BufferSource,
		device,
		{ name: 'AES-GCM', iv: iv as BufferSource },
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

export const _internal = { toBase64, fromBase64 };
