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
	createdAt: number;
}

export interface VaultData {
	schemaVersion: 1;
	servers: ServerProfile[];
	createdAt: number;
}

export const EMPTY_VAULT_DATA: VaultData = {
	schemaVersion: 1,
	servers: [],
	createdAt: 0
};
