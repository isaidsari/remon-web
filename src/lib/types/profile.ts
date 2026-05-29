import type { DashboardLayout } from './dashboard';

export interface ServerProfile {
	id: string;
	name: string;
	/** e.g. `http://192.168.1.x:8080`. No trailing slash, no path. */
	baseUrl: string;
	/** UUID returned by `POST /auth/pair/complete`. */
	deviceId: string;
	/** 64-hex token returned by `POST /auth/pair/complete`. */
	deviceToken: string;
	notes?: string;
	/** Per-server accent hex (#rrggbb) — visual differentiation between servers. */
	accent?: string;
	/** Customizable overview layout. Absent on v1 vaults / fresh profiles → a default is generated on first render. */
	dashboard?: DashboardLayout;
	createdAt: number;
}

/** Current persisted vault schema version. */
export const VAULT_SCHEMA_VERSION = 2;

export interface VaultData {
	schemaVersion: 1 | 2;
	servers: ServerProfile[];
	createdAt: number;
}

export const EMPTY_VAULT_DATA: VaultData = {
	schemaVersion: VAULT_SCHEMA_VERSION,
	servers: [],
	createdAt: 0
};

/**
 * Forward-migrate a decrypted vault to the current schema. v1→v2 only bumps the
 * version marker — the `dashboard` field is optional, so older profiles simply
 * have none until the dashboard page generates a default and saves it.
 */
export function migrateVaultData(data: VaultData): VaultData {
	if (data.schemaVersion >= VAULT_SCHEMA_VERSION) return data;
	return { ...data, schemaVersion: VAULT_SCHEMA_VERSION };
}
