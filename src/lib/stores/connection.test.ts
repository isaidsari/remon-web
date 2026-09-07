import { afterEach, expect, test } from 'bun:test';
import { plugin } from 'bun';
import { compileModule } from 'svelte/compiler';
import { ApiError } from '../api/error';

// Compile runes to their server form: these tests exercise asynchronous
// session behavior without mounting UI or opening the application's vault.
plugin({
	name: 'session-runes-tests',
	setup(build) {
		build.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
			const source = new Bun.Transpiler({ loader: 'ts' }).transformSync(
				await Bun.file(path).text()
			);
			return {
				contents: compileModule(source, { filename: path, generate: 'server' }).js.code,
				loader: 'js'
			};
		});
	}
});
const { Connection } = await import('./connection.svelte');
const connections: InstanceType<typeof Connection>[] = [];
const channels: BroadcastChannel[] = [];
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
afterEach(() => {
	for (const connection of connections.splice(0)) connection.dispose();
	for (const channel of channels.splice(0)) channel.close();
	if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
	else Reflect.deleteProperty(navigator, 'locks');
});
function makeConnection() {
	const id = crypto.randomUUID();
	const connection = new Connection({
		id,
		name: 'test',
		baseUrl: 'https://server.test',
		deviceId: id,
		deviceToken: 'device-secret',
		createdAt: 0
	});
	connections.push(connection);
	return connection;
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
const tokens = { access_token: 'old-access', refresh_token: 'old-refresh', expires_in: 120 };
const invalidToken = () =>
	new ApiError({ code: 'INVALID_TOKEN', status: 401, userMessage: 'expired' });

test('simultaneous sign-in callers wait for the same login', async () => {
	const connection = makeConnection();
	const pending = deferred<typeof tokens>();
	let calls = 0;
	connection.client.login = async () => {
		calls++;
		return pending.promise;
	};
	const first = connection.ensureSignedIn();
	let secondFinished = false;
	const second = connection.ensureSignedIn().then(() => {
		secondFinished = true;
	});
	await Bun.sleep(1);
	expect(secondFinished).toBe(false);
	pending.resolve(tokens);
	await Promise.all([first, second]);
	expect(calls).toBe(1);
});

test('late failed refresh does not erase tokens received from another tab', async () => {
	const connection = makeConnection();
	connection.client.login = async () => tokens;
	await connection.login();
	const pending = deferred<typeof tokens>();
	connection.client.refresh = async () => pending.promise;
	const refresh = connection.refresh();
	const channel = new BroadcastChannel(`remon-conn:${connection.serverId}`);
	channels.push(channel);
	channel.postMessage({
		type: 'tokens',
		from: 'another-tab',
		accessToken: 'new-access',
		refreshToken: 'new-refresh',
		expiresAt: Date.now() + 240_000
	});
	for (let i = 0; i < 50 && connection.accessToken !== 'new-access'; i++) await Bun.sleep(2);
	expect(connection.accessToken).toBe('new-access');
	pending.reject(invalidToken());
	await refresh;
	expect(connection.accessToken).toBe('new-access');
	expect(connection.isAuthenticated).toBe(true);
});

test('an expired refresh session recovers with the paired device credential', async () => {
	const connection = makeConnection();
	let logins = 0;
	connection.client.login = async () => ({ ...tokens, access_token: `access-${++logins}` });
	await connection.login();
	connection.client.refresh = async () => {
		throw invalidToken();
	};
	await connection.refresh();
	expect(connection.accessToken).toBe('access-2');
	expect(connection.isAuthenticated).toBe(true);
});

test('disposing during login prevents a late response from reopening the session', async () => {
	const connection = makeConnection();
	const pending = deferred<typeof tokens>();
	connection.client.login = async () => pending.promise;
	const login = connection.login();
	connection.dispose();
	pending.resolve(tokens);
	await login;
	expect(connection.accessToken).toBeNull();
	expect(connection.status).toBe('idle');
});

test('simultaneous refresh callers share one request', async () => {
	const connection = makeConnection();
	connection.client.login = async () => tokens;
	await connection.login();
	const pending = deferred<typeof tokens>();
	let calls = 0;
	connection.client.refresh = async () => {
		calls++;
		return pending.promise;
	};
	const first = connection.refresh();
	const second = connection.refresh();
	pending.resolve({ ...tokens, access_token: 'rotated' });
	await Promise.all([first, second]);
	expect(calls).toBe(1);
	expect(connection.accessToken).toBe('rotated');
});

test('tokens received while waiting for the cross-tab lock skip the obsolete refresh', async () => {
	const connection = makeConnection();
	connection.client.login = async () => tokens;
	await connection.login();
	let run!: () => Promise<void>;
	let lockName = '';
	const lockResult = deferred<void>();
	Object.defineProperty(navigator, 'locks', {
		configurable: true,
		value: {
			request: (name: string, callback: () => Promise<void>) => {
				lockName = name;
				run = callback;
				return lockResult.promise;
			}
		}
	});
	let refreshCalls = 0;
	connection.client.refresh = async () => {
		refreshCalls++;
		return tokens;
	};
	const refresh = connection.refresh();
	const channel = new BroadcastChannel(`remon-conn:${connection.serverId}`);
	channels.push(channel);
	channel.postMessage({
		type: 'tokens',
		from: 'another-tab',
		accessToken: 'winner',
		refreshToken: 'winner-refresh',
		expiresAt: Date.now() + 240_000
	});
	for (let i = 0; i < 50 && connection.accessToken !== 'winner'; i++) await Bun.sleep(2);
	expect(connection.accessToken).toBe('winner');
	await run();
	lockResult.resolve();
	await refresh;
	expect(lockName).toBe(`remon-refresh:https://server.test:${connection.serverId}`);
	expect(refreshCalls).toBe(0);
});

test('a revoked device remains an error when recovery login is rejected', async () => {
	const connection = makeConnection();
	connection.client.login = async () => tokens;
	await connection.login();
	connection.client.refresh = async () => {
		throw invalidToken();
	};
	connection.client.login = async () => {
		throw new ApiError({
			code: 'DEVICE_INACTIVE',
			status: 401,
			userMessage: 'revoked'
		});
	};
	await expect(connection.refresh()).rejects.toMatchObject({ code: 'DEVICE_INACTIVE' });
	expect(connection.status).toBe('error');
	expect(connection.accessToken).toBeNull();
});

test('disposing during refresh discards the rotated pair', async () => {
	const connection = makeConnection();
	connection.client.login = async () => tokens;
	await connection.login();
	const pending = deferred<typeof tokens>();
	connection.client.refresh = async () => pending.promise;
	const refresh = connection.refresh();
	connection.dispose();
	pending.resolve({ ...tokens, access_token: 'late' });
	await refresh;
	expect(connection.status).toBe('idle');
	expect(connection.accessToken).toBeNull();
});
