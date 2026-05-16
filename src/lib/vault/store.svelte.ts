
import type { VaultData } from '$lib/types/profile';
import { EMPTY_VAULT_DATA } from '$lib/types/profile';
import {
	KDF_ITERATIONS,
	SALT_LENGTH,
	deriveKey,
	encryptJson,
	decryptJson,
	randomBytes,
	type EncryptedBlob
} from './crypto';

export type VaultState = 'none' | 'locked' | 'open';

const VAULT_KEY = 'remon-web:vault';

let state = $state<VaultState>('none');
let data = $state<VaultData | null>(null);

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

function bootstrap() {
	const blob = readBlob();
	if (blob) {
		cachedBlob = blob;
		state = 'locked';
	} else {
		state = 'none';
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

function destroy() {
	if (isBrowser()) localStorage.removeItem(VAULT_KEY);
	cachedBlob = null;
	lock();
	state = 'none';
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
	get hasVault() {
		return state !== 'none';
	},
	get data() {
		return data;
	},
	create: createVault,
	unlock,
	lock,
	write,
	destroy
};
