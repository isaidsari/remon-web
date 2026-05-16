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

export const _internal = { toBase64, fromBase64 };
