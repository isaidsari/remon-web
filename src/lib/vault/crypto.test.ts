import { describe, it, expect } from 'bun:test';
import {
	KDF_ITERATIONS,
	SALT_LENGTH,
	IV_LENGTH,
	randomBytes,
	deriveKey,
	encryptJson,
	decryptJson,
	_internal
} from './crypto';

async function fastKey(password = 'hunter2'): Promise<{ key: CryptoKey; salt: Uint8Array }> {
	const salt = randomBytes(SALT_LENGTH);
	const key = await deriveKey(password, salt, 1_000);
	return { key, salt };
}

describe('randomBytes', () => {
	it('returns a Uint8Array of the requested length', () => {
		for (const n of [1, 16, 32, 128]) {
			const buf = randomBytes(n);
			expect(buf).toBeInstanceOf(Uint8Array);
			expect(buf.length).toBe(n);
		}
	});

	it('two successive calls produce different values', () => {
		const a = randomBytes(32);
		const b = randomBytes(32);
		expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'));
	});
});

describe('deriveKey', () => {
	it('returns a non-extractable AES-GCM CryptoKey', async () => {
		const salt = randomBytes(SALT_LENGTH);
		const key = await deriveKey('password', salt, 1_000);
		expect(key.type).toBe('secret');
		expect(key.algorithm.name).toBe('AES-GCM');
		expect(key.extractable).toBe(false);
		expect(key.usages).toContain('encrypt');
		expect(key.usages).toContain('decrypt');
	});

	it('KDF_ITERATIONS meets OWASP 2023 baseline', () => {
		expect(KDF_ITERATIONS).toBe(600_000);
	});
});

describe('encryptJson / decryptJson', () => {
	it('round-trips a plain object', async () => {
		const { key, salt } = await fastKey();
		const original = { hello: 'world', n: 42, nested: { arr: [1, 2, 3] } };
		const blob = await encryptJson(key, original, salt, 1_000);
		expect(await decryptJson<typeof original>(key, blob)).toEqual(original);
	});

	it('round-trips an array', async () => {
		const { key, salt } = await fastKey();
		const original = ['a', 'b', 'c'];
		const blob = await encryptJson(key, original, salt, 1_000);
		expect(await decryptJson<typeof original>(key, blob)).toEqual(original);
	});

	it('produces a well-formed EncryptedBlob', async () => {
		const { key, salt } = await fastKey();
		const blob = await encryptJson(key, { x: 1 }, salt, 1_000);
		expect(blob.v).toBe(1);
		expect(blob.kdf.algo).toBe('PBKDF2-SHA256');
		expect(blob.kdf.iter).toBe(1_000);
		expect(typeof blob.kdf.salt).toBe('string');
		expect(typeof blob.iv).toBe('string');
		expect(typeof blob.ct).toBe('string');
	});

	it('IV length matches IV_LENGTH constant', async () => {
		const { key, salt } = await fastKey();
		const blob = await encryptJson(key, { x: 1 }, salt, 1_000);
		expect(_internal.fromBase64(blob.iv).length).toBe(IV_LENGTH);
	});

	it('salt length matches SALT_LENGTH constant', async () => {
		const { key, salt } = await fastKey();
		const blob = await encryptJson(key, { x: 1 }, salt, 1_000);
		expect(_internal.fromBase64(blob.kdf.salt).length).toBe(SALT_LENGTH);
	});
});

describe('decryptJson with wrong key', () => {
	it('throws when decrypting with a different password', async () => {
		const { key: goodKey, salt } = await fastKey('correct-horse');
		const { key: badKey } = await fastKey('battery-staple');
		const blob = await encryptJson(goodKey, { secret: true }, salt, 1_000);
		await expect(decryptJson(badKey, blob)).rejects.toThrow();
	});
});

describe('IV uniqueness', () => {
	it('each encryptJson call generates a fresh IV', async () => {
		const { key, salt } = await fastKey();
		const payload = { msg: 'same plaintext' };
		const [b1, b2] = await Promise.all([
			encryptJson(key, payload, salt, 1_000),
			encryptJson(key, payload, salt, 1_000)
		]);
		expect(b1.iv).not.toBe(b2.iv);
		expect(b1.ct).not.toBe(b2.ct);
	});
});

describe('_internal base64 helpers', () => {
	const { toBase64, fromBase64 } = _internal;

	it('toBase64 → fromBase64 is identity', () => {
		const bytes = new Uint8Array([0, 1, 127, 128, 255, 42, 99]);
		expect(fromBase64(toBase64(bytes))).toEqual(bytes);
	});

	it('handles empty array', () => {
		expect(fromBase64(toBase64(new Uint8Array(0)))).toEqual(new Uint8Array(0));
	});

	it('handles full 0–255 byte range', () => {
		const all = new Uint8Array(256).map((_, i) => i);
		expect(fromBase64(toBase64(all))).toEqual(all);
	});

	it('output is valid base64', () => {
		expect(toBase64(randomBytes(64))).toMatch(/^[A-Za-z0-9+/]+=*$/);
	});

	it('fromBase64 → toBase64 is identity', () => {
		const b64 = btoa('Hello, vault!');
		expect(toBase64(fromBase64(b64))).toBe(b64);
	});
});

describe('tampered ciphertext', () => {
	it('throws when a byte in the middle is flipped', async () => {
		const { key, salt } = await fastKey();
		const blob = await encryptJson(key, { sensitive: 'data' }, salt, 1_000);
		const ct = _internal.fromBase64(blob.ct);
		ct[Math.floor(ct.length / 2)] ^= 0xff;
		await expect(decryptJson(key, { ...blob, ct: _internal.toBase64(ct) })).rejects.toThrow();
	});

	it('throws when the last byte (GCM tag area) is flipped', async () => {
		const { key, salt } = await fastKey();
		const blob = await encryptJson(key, { sensitive: 'data' }, salt, 1_000);
		const ct = _internal.fromBase64(blob.ct);
		ct[ct.length - 1] ^= 0x01;
		await expect(decryptJson(key, { ...blob, ct: _internal.toBase64(ct) })).rejects.toThrow();
	});
});
