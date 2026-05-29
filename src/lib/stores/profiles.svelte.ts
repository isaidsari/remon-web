import { vault } from '$lib/vault/store.svelte';
import type { ServerProfile, VaultData } from '$lib/types/profile';
import type { DashboardLayout } from '$lib/types/dashboard';

function uuid(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
	// Fallback: not cryptographically perfect but profile ids are not secrets.
	return Math.random().toString(36).slice(2) + Date.now().toString(36);
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

	/** Persist a server's customizable dashboard layout. */
	async setDashboard(id: string, dashboard: DashboardLayout): Promise<void> {
		const cur = snapshot();
		const next = cur.servers.map((s) => (s.id === id ? { ...s, dashboard } : s));
		await persist({ ...cur, servers: next });
	},

	async remove(id: string): Promise<void> {
		const cur = snapshot();
		const next = cur.servers.filter((s) => s.id !== id);
		await persist({ ...cur, servers: next });
	}
};
