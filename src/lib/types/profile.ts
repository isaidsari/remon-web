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
	/** The overview page as a screen spec (docs/screens.md). Raw, parsed on
	 *  read; absent until first edited, which shows the default. */
	home?: unknown;
	createdAt: number;
}

/** Current persisted vault schema version. */
export const VAULT_SCHEMA_VERSION = 3;

export interface VaultData {
	schemaVersion: 1 | 2 | 3;
	servers: ServerProfile[];
	createdAt: number;
}

export const EMPTY_VAULT_DATA: VaultData = {
	schemaVersion: VAULT_SCHEMA_VERSION,
	servers: [],
	createdAt: 0
};

/**
 * Forward-migrate a decrypted vault. v1→v2 only bumped the version marker.
 * v2→v3 drops the grid `dashboard` layouts: the overview became a screen, and
 * old layouts are reset to the default rather than converted.
 */
export function migrateVaultData(data: VaultData): VaultData {
	if (data.schemaVersion >= VAULT_SCHEMA_VERSION) return data;
	return {
		...data,
		schemaVersion: VAULT_SCHEMA_VERSION,
		servers: data.servers.map((s) => {
			const { dashboard: _dropped, ...rest } = s as ServerProfile & { dashboard?: unknown };
			return rest;
		})
	};
}
