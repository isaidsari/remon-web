import type { EncryptedBlob } from '$lib/vault/crypto';
import { vault } from '$lib/vault/store.svelte';
import { overflowing, sortByRecent, type Conversation } from './conversation';

// Saved conversations live in their own IndexedDB, each sealed with the vault's
// master key. Out of the vault blob on purpose: that one is rewritten whole on
// every change and shares localStorage's few megabytes with the credentials,
// while a transcript only grows.
//
// Nothing here talks to remon-server. The daemon authenticates devices, not
// people, so server-side history could only be "visible to every paired device"
// or "still device-local" — neither is what a shared history should mean. The
// model in ./conversation is portable if that ever changes.

const DB_NAME = 'remon-web-assistant';
const DB_VERSION = 1;
const STORE = 'conversations';

/** What IndexedDB holds: only the routing fields stay readable. */
interface ConversationRecord {
	id: string;
	serverId: string;
	updatedAt: number;
	blob: EncryptedBlob;
}

/** Sealed half — the words never reach the disk in the clear. */
type SealedBody = Pick<Conversation, 'title' | 'createdAt' | 'turns'>;

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
			store.createIndex('serverId', 'serverId');
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function readAll(serverId: string): Promise<ConversationRecord[]> {
	return openDb().then(
		(db) =>
			new Promise<ConversationRecord[]>((resolve, reject) => {
				const tx = db.transaction(STORE, 'readonly');
				const req = tx.objectStore(STORE).index('serverId').getAll(serverId);
				req.onsuccess = () => resolve((req.result as ConversationRecord[]) ?? []);
				req.onerror = () => reject(req.error);
			})
	);
}

function put(record: ConversationRecord): Promise<void> {
	return openDb().then(
		(db) =>
			new Promise<void>((resolve, reject) => {
				const tx = db.transaction(STORE, 'readwrite');
				tx.objectStore(STORE).put(record);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			})
	);
}

function del(id: string): Promise<void> {
	return openDb().then(
		(db) =>
			new Promise<void>((resolve, reject) => {
				const tx = db.transaction(STORE, 'readwrite');
				tx.objectStore(STORE).delete(id);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			})
	);
}

/** Newest first. A record that will not decrypt is skipped, not thrown over. */
export async function listConversations(serverId: string): Promise<Conversation[]> {
	if (!vault.isOpen) return [];
	const out: Conversation[] = [];
	for (const record of sortByRecent(await readAll(serverId))) {
		try {
			const body = await vault.unseal<SealedBody>(record.blob);
			out.push({ id: record.id, serverId: record.serverId, updatedAt: record.updatedAt, ...body });
		} catch {
			// Sealed under a vault that no longer exists — leave it be.
		}
	}
	return out;
}

export async function saveConversation(conversation: Conversation): Promise<void> {
	if (!vault.isOpen) return;
	const body: SealedBody = {
		title: conversation.title,
		createdAt: conversation.createdAt,
		turns: conversation.turns
	};
	await put({
		id: conversation.id,
		serverId: conversation.serverId,
		updatedAt: conversation.updatedAt,
		blob: await vault.seal(body)
	});
	for (const stale of overflowing(await readAll(conversation.serverId))) await del(stale.id);
}

export async function deleteConversation(id: string): Promise<void> {
	await del(id);
}

export async function clearConversations(serverId: string): Promise<void> {
	for (const record of await readAll(serverId)) await del(record.id);
}
