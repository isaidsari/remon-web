import { describe, expect, it } from 'bun:test';
import { migrateVaultData, VAULT_SCHEMA_VERSION, type VaultData } from './profile';

const server = {
	id: 's',
	name: 'n',
	baseUrl: 'http://h',
	deviceId: 'd',
	deviceToken: 't',
	createdAt: 1
};

describe('migrateVaultData', () => {
	it('resets grid dashboards on the way to v3 and keeps everything else', () => {
		const v2 = {
			schemaVersion: 2,
			createdAt: 1,
			servers: [{ ...server, accent: '#ff0000', dashboard: { version: 1, widgets: [] } }]
		} as VaultData;
		const out = migrateVaultData(v2);
		expect(out.schemaVersion).toBe(VAULT_SCHEMA_VERSION);
		expect(out.servers[0]).toEqual({ ...server, accent: '#ff0000' });
	});

	it('leaves a current vault alone', () => {
		const v3: VaultData = {
			schemaVersion: 3,
			createdAt: 1,
			servers: [{ ...server, home: { title: 'x' } }]
		};
		expect(migrateVaultData(v3)).toBe(v3);
	});
});
