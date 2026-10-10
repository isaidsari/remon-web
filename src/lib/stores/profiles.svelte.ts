import { vault } from '$lib/vault/store.svelte';
import type { ServerProfile, VaultData } from '$lib/types/profile';

function uuid(): string {
	return crypto.randomUUID();
}

function snapshot(): VaultData {
	const data = vault.data;
	if (!data) throw new Error('Vault is not open — cannot read profiles');
	return data;
}

async function persist(next: VaultData) {
	await vault.write(next);
}

export const profiles = {
	get list(): ServerProfile[] {
		return vault.data?.servers ?? [];
	},

	byId(id: string): ServerProfile | undefined {
		return vault.data?.servers.find((s) => s.id === id);
	},

	async add(input: {
		name: string;
		baseUrl: string;
		deviceId: string;
		deviceToken: string;
		notes?: string;
	}): Promise<ServerProfile> {
		const cur = snapshot();
		const profile: ServerProfile = {
			id: uuid(),
			name: input.name,
			baseUrl: input.baseUrl.replace(/\/+$/, ''),
			deviceId: input.deviceId,
			deviceToken: input.deviceToken,
			notes: input.notes,
			createdAt: Date.now()
		};
		await persist({ ...cur, servers: [...cur.servers, profile] });
		return profile;
	},

	async update(id: string, patch: Partial<Omit<ServerProfile, 'id' | 'createdAt'>>): Promise<void> {
		const cur = snapshot();
		const next = cur.servers.map((s) => (s.id === id ? { ...s, ...patch } : s));
		await persist({ ...cur, servers: next });
	},

	/** Persist a server's overview screen; null goes back to the default. */
	async setHome(id: string, home: unknown | null): Promise<void> {
		const cur = snapshot();
		const next = cur.servers.map((s) => {
			if (s.id !== id) return s;
			const { home: _old, ...rest } = s;
			return home == null ? rest : { ...rest, home };
		});
		await persist({ ...cur, servers: next });
	},

	async remove(id: string): Promise<void> {
		const cur = snapshot();
		const next = cur.servers.filter((s) => s.id !== id);
		await persist({ ...cur, servers: next });
	}
};
