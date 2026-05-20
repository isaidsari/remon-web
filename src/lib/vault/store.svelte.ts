
import type { VaultData } from '$lib/types/profile';
import { EMPTY_VAULT_DATA } from '$lib/types/profile';
import {
	KDF_ITERATIONS,
	SALT_LENGTH,
	deriveKey,
	deriveKeyExtractable,
	encryptJson,
	decryptJson,
	randomBytes,
	getOrCreateDeviceKey,
	getDeviceKey,
	deleteDeviceKey,
	wrapMasterKey,
	unwrapMasterKey,
	type EncryptedBlob,
	type WrappedKey
} from './crypto';

// 'pending' covers the async window during bootstrap when we're trying to
// auto-unlock from a wrapped key in IndexedDB. The root layout treats it like
// 'locked' for content gating but suppresses any redirects so we don't flash
// the unlock screen before async unwrap resolves.
export type VaultState = 'none' | 'locked' | 'open' | 'pending';

const VAULT_KEY = 'remon-web:vault';
const WRAPPED_KEY = 'remon-web:wrapped-master';

let state = $state<VaultState>('none');
let data = $state<VaultData | null>(null);
let isTrusted = $state<boolean>(false);

let cachedBlob: EncryptedBlob | null = null;
let key: CryptoKey | null = null;
let salt: Uint8Array | null = null;
let iterations: number = KDF_ITERATIONS;

function isBrowser(): boolean {
	return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function readBlob(): EncryptedBlob | null {
	if (!isBrowser()) return null;
	const raw = localStorage.getItem(VAULT_KEY);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as EncryptedBlob;
		if (parsed && parsed.v === 1 && parsed.kdf && parsed.iv && parsed.ct) return parsed;
		return null;
	} catch {
		return null;
	}
}

function writeBlob(blob: EncryptedBlob) {
	if (!isBrowser()) return;
	localStorage.setItem(VAULT_KEY, JSON.stringify(blob));
}

function readWrappedKey(): WrappedKey | null {
	if (!isBrowser()) return null;
	const raw = localStorage.getItem(WRAPPED_KEY);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as WrappedKey;
		if (parsed && parsed.v === 1 && parsed.iv && parsed.ct) return parsed;
		return null;
	} catch {
		return null;
	}
}

function writeWrappedKey(wrapped: WrappedKey) {
	if (!isBrowser()) return;
	localStorage.setItem(WRAPPED_KEY, JSON.stringify(wrapped));
}

function clearWrappedKey() {
	if (!isBrowser()) return;
	localStorage.removeItem(WRAPPED_KEY);
}

async function autoUnlock(blob: EncryptedBlob, wrapped: WrappedKey): Promise<boolean> {
	try {
		const device = await getDeviceKey();
		if (!device) return false;
		const candidateKey = await unwrapMasterKey(wrapped, device);
		const decrypted = await decryptJson<VaultData>(candidateKey, blob);
		key = candidateKey;
		salt = base64ToBytes(blob.kdf.salt);
		iterations = blob.kdf.iter;
		data = decrypted;
		isTrusted = true;
		state = 'open';
		return true;
	} catch {
		// Wrapped key is stale (e.g. password was changed elsewhere, IndexedDB
		// was wiped, or vault was rewrapped). Drop the marker and fall back to
		// the password prompt.
		clearWrappedKey();
		await deleteDeviceKey();
		isTrusted = false;
		return false;
	}
}

function bootstrap() {
	const blob = readBlob();
	if (!blob) {
		state = 'none';
		return;
	}
	cachedBlob = blob;

	const wrapped = readWrappedKey();
	if (wrapped) {
		// Sync marker exists; trust is enabled. Stay in 'pending' while the
		// async unwrap runs so the layout doesn't bounce through /unlock.
		state = 'pending';
		void autoUnlock(blob, wrapped).then((ok) => {
			if (!ok) state = 'locked';
		});
	} else {
		state = 'locked';
	}
}

if (isBrowser()) bootstrap();

async function createVault(password: string, initial?: Partial<VaultData>): Promise<void> {
	const newSalt = randomBytes(SALT_LENGTH);
	const newKey = await deriveKey(password, newSalt, KDF_ITERATIONS);
	const initialData: VaultData = {
		...EMPTY_VAULT_DATA,
		...initial,
		schemaVersion: 1,
		createdAt: Date.now()
	};
	const blob = await encryptJson(newKey, initialData, newSalt, KDF_ITERATIONS);
	writeBlob(blob);

	key = newKey;
	salt = newSalt;
	iterations = KDF_ITERATIONS;
	cachedBlob = blob;
	data = initialData;
	state = 'open';
}

async function unlock(password: string): Promise<void> {
	if (!cachedBlob) {
		// Re-read in case another tab created a vault since bootstrap.
		cachedBlob = readBlob();
		if (!cachedBlob) throw new Error('No vault present');
	}
	const blob = cachedBlob;

	const blobSalt = base64ToBytes(blob.kdf.salt);
	const blobIter = blob.kdf.iter;
	const candidateKey = await deriveKey(password, blobSalt, blobIter);

	const decrypted = await decryptJson<VaultData>(candidateKey, blob);

	key = candidateKey;
	salt = blobSalt;
	iterations = blobIter;
	data = decrypted;
	state = 'open';
}

function lock() {
	key = null;
	salt = null;
	data = null;
	state = cachedBlob ? 'locked' : 'none';
}

async function write(next: VaultData): Promise<void> {
	if (state !== 'open' || !key || !salt) throw new Error('Vault is not open');
	const blob = await encryptJson(key, next, salt, iterations);
	writeBlob(blob);
	cachedBlob = blob;
	data = next;
}

async function trustDevice(password: string): Promise<void> {
	if (state !== 'open' || !salt) throw new Error('Vault must be open to trust device');
	// Re-derive an extractable copy of the master key so it can be wrapped.
	// The in-memory `key` stays non-extractable for normal vault operations.
	const extractable = await deriveKeyExtractable(password, salt, iterations);
	const device = await getOrCreateDeviceKey();
	const wrapped = await wrapMasterKey(extractable, device);
	writeWrappedKey(wrapped);
	isTrusted = true;
}

async function untrustDevice(): Promise<void> {
	clearWrappedKey();
	await deleteDeviceKey();
	isTrusted = false;
}

function destroy() {
	if (isBrowser()) localStorage.removeItem(VAULT_KEY);
	clearWrappedKey();
	void deleteDeviceKey();
	cachedBlob = null;
	lock();
	state = 'none';
	isTrusted = false;
}

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const u8 = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
	return u8;
}

export const vault = {
	get state() {
		return state;
	},
	get isOpen() {
		return state === 'open';
	},
	get isLocked() {
		return state === 'locked';
	},
	get isPending() {
		return state === 'pending';
	},
	get hasVault() {
		return state !== 'none';
	},
	get isTrusted() {
		return isTrusted;
	},
	get data() {
		return data;
	},
	create: createVault,
	unlock,
	lock,
	write,
	trustDevice,
	untrustDevice,
	destroy
};
