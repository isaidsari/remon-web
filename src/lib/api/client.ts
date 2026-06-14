import type { RawStats } from '$lib/utils/dockerStats';
import type {
	AlertRuleDto,
	BatchMetricsQuery,
	BatchMetricsResponse,
	ComponentsHistoryResponse,
	ConfigResponse,
	ContainerInspectInfo,
	CpuCoresHistoryResponse,
	CpuHistoryResponse,
	CreateAlertRuleRequest,
	CreateChannelRequest,
	DeviceLoginRequest,
	DiskHistoryResponse,
	DockerActionResponse,
	DockerStatusResponse,
	GetContainerLogsRequest,
	GetContainerLogsResponse,
	GetProcessesResponse,
	AlertsSchemaResponse,
	HealthResponse,
	ReadyResponse,
	LogsQuery,
	LogsResponse,
	ListAlertEventsResponse,
	ListAlertRulesResponse,
	ListAlertStateResponse,
	ListChannelsResponse,
	ListContainersResponse,
	ListCronJobsResponse,
	ListImagesResponse,
	ListProbesResponse,
	ListServicesQuery,
	ListServicesResponse,
	ListSessionsResponse,
	ListTimersResponse,
	MemoryHistoryResponse,
	MetricsRangeQuery,
	NetworkHistoryResponse,
	NotificationChannelResponse,
	PairCompleteRequest,
	PairCompleteResponse,
	PairingInitiateResponse,
	PressureHistoryResponse,
	PressureResource,
	ProbeDetail,
	ProbeHistoryResponse,
	ProbeMetricHistoryResponse,
	ProbeMetricRangeQuery,
	PruneResult,
	RefreshRequest,
	ReloadProbesResponse,
	ServiceActionResponse,
	ServiceDto,
	SilenceAlertRequest,
	SystemInfoResponse,
	SmartResponse,
	SummaryResponse,
	TestChannelResponse,
	TokenResponse,
	UpdateAlertRuleRequest,
	UpdateChannelRequest,
	UpdateConfigRequest
} from '$lib/types/api';
import { ApiError, errorFromResponse, errorFromThrown } from './error';

export type AccessTokenProvider = () => string | null;

interface RequestOptions {
	method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
	auth?: boolean;
	body?: unknown;
	query?: Record<string, unknown>;
	signal?: AbortSignal;
	timeoutMs?: number;
	parse?: 'json' | 'text' | 'none';
	/** Skip the short-TTL GET cache. Use on explicit user-triggered refreshes. */
	bypassCache?: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const GET_CACHE_TTL_MS = 5_000;

export class ApiClient {
	readonly baseUrl: string;
	private getAccessToken: AccessTokenProvider;
	private getCache = new Map<string, { data: unknown; ts: number }>();
	private inflight = new Map<string, Promise<unknown>>();

	constructor(baseUrl: string, getAccessToken: AccessTokenProvider = () => null) {
		this.baseUrl = baseUrl.replace(/\/+$/, '');
		this.getAccessToken = getAccessToken;
	}

	setAccessTokenProvider(provider: AccessTokenProvider) {
		this.getAccessToken = provider;
	}

	async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
		const {
			method = 'GET',
			auth = true,
			body,
			query,
			signal,
			timeoutMs = DEFAULT_TIMEOUT_MS,
			parse = 'json',
			bypassCache = false
		} = opts;

		const url = this.buildUrl(path, query);

		const cacheable = method === 'GET' && !bypassCache && !signal;
		if (cacheable) {
			const cached = this.getCache.get(url);
			if (cached && Date.now() - cached.ts < GET_CACHE_TTL_MS) {
				return cached.data as T;
			}
			const existing = this.inflight.get(url);
			if (existing) return existing as Promise<T>;
		}

		const exec = async (): Promise<T> => {
			const headers = new Headers();
			if (body !== undefined) headers.set('content-type', 'application/json');
			if (auth) {
				const token = this.getAccessToken();
				if (!token) {
					throw new ApiError({
						code: 'UNAUTHORIZED',
						status: 0,
						userMessage: 'Not signed in.',
						serverMessage: 'no access token available'
					});
				}
				headers.set('authorization', `Bearer ${token}`);
			}

			const timeoutCtrl = new AbortController();
			const timer = window.setTimeout(() => timeoutCtrl.abort(), timeoutMs);
			const finalSignal = mergeSignals(signal, timeoutCtrl.signal);

			let res: Response;
			try {
				res = await fetch(url, {
					method,
					headers,
					body: body !== undefined ? JSON.stringify(body) : undefined,
					signal: finalSignal,
					credentials: 'omit'
				});
			} catch (e) {
				throw errorFromThrown(e);
			} finally {
				clearTimeout(timer);
			}

			if (!res.ok) throw await errorFromResponse(res);

			if (parse === 'none') return undefined as T;
			if (parse === 'text') return (await res.text()) as T;
			// 204 No Content for endpoints like logout/delete-process: avoid JSON parse.
			if (res.status === 204) return undefined as T;
			return (await res.json()) as T;
		};

		if (!cacheable) return exec();

		const promise = exec();
		this.inflight.set(url, promise);
		if (this.getCache.size > 50) {
			const now = Date.now();
			for (const [k, v] of this.getCache) {
				if (now - v.ts > GET_CACHE_TTL_MS) this.getCache.delete(k);
			}
		}
		promise
			.then((data) => this.getCache.set(url, { data, ts: Date.now() }))
			.catch(() => {
				/* don't cache failures */
			})
			.finally(() => this.inflight.delete(url));
		return promise;
	}

	private buildUrl(path: string, query?: Record<string, unknown>): string {
		const url = new URL(path.startsWith('/') ? path.slice(1) : path, this.baseUrl + '/');
		if (query) {
			for (const [k, v] of Object.entries(query)) {
				if (v === undefined || v === null || v === '') continue;
				url.searchParams.set(k, String(v));
			}
		}
		return url.toString();
	}

	/** Liveness probe. Resolves when the process is up and routing. */
	health(): Promise<HealthResponse> {
		return this.request<HealthResponse>('/health', { auth: false });
	}

	/** Readiness probe. Resolves with `status: 'ready'` once the DB answers;
	 *  rejects (503) while the pool can't serve queries. */
	ready(): Promise<ReadyResponse> {
		return this.request<ReadyResponse>('/ready', { auth: false });
	}

	pairInitiate(): Promise<PairingInitiateResponse> {
		return this.request<PairingInitiateResponse>('/auth/pair/initiate', {
			method: 'POST',
			auth: false
		});
	}

	pairComplete(req: PairCompleteRequest): Promise<PairCompleteResponse> {
		return this.request<PairCompleteResponse>('/auth/pair/complete', {
			method: 'POST',
			auth: false,
			body: req
		});
	}

	login(req: DeviceLoginRequest): Promise<TokenResponse> {
		return this.request<TokenResponse>('/auth/login', {
			method: 'POST',
			auth: false,
			body: req
		});
	}

	refresh(req: RefreshRequest): Promise<TokenResponse> {
		return this.request<TokenResponse>('/auth/refresh', {
			method: 'POST',
			auth: false,
			body: req
		});
	}

	logout(): Promise<void> {
		return this.request<void>('/auth/logout', { method: 'POST', parse: 'none' });
	}

	getConfig(): Promise<ConfigResponse> {
		return this.request<ConfigResponse>('/config');
	}

	patchConfig(req: UpdateConfigRequest): Promise<ConfigResponse> {
		return this.request<ConfigResponse>('/config', { method: 'PATCH', body: req });
	}

	cpuHistory(q: MetricsRangeQuery = {}): Promise<CpuHistoryResponse> {
		return this.request<CpuHistoryResponse>('/metrics/cpu', { query: { ...q } });
	}

	cpuCoresHistory(q: MetricsRangeQuery = {}): Promise<CpuCoresHistoryResponse> {
		return this.request<CpuCoresHistoryResponse>('/metrics/cpu/cores', { query: { ...q } });
	}

	memoryHistory(q: MetricsRangeQuery = {}): Promise<MemoryHistoryResponse> {
		return this.request<MemoryHistoryResponse>('/metrics/memory', { query: { ...q } });
	}

	diskHistory(q: MetricsRangeQuery = {}): Promise<DiskHistoryResponse> {
		return this.request<DiskHistoryResponse>('/metrics/disk', { query: { ...q } });
	}

	networkHistory(q: MetricsRangeQuery = {}): Promise<NetworkHistoryResponse> {
		return this.request<NetworkHistoryResponse>('/metrics/network', { query: { ...q } });
	}

	pressureHistory(
		resource: PressureResource,
		q: MetricsRangeQuery = {}
	): Promise<PressureHistoryResponse> {
		return this.request<PressureHistoryResponse>(`/metrics/pressure/${resource}`, {
			query: { ...q }
		});
	}

	componentsHistory(q: MetricsRangeQuery = {}): Promise<ComponentsHistoryResponse> {
		return this.request<ComponentsHistoryResponse>('/metrics/components', { query: { ...q } });
	}

	metricsBatch(q: BatchMetricsQuery): Promise<BatchMetricsResponse> {
		return this.request<BatchMetricsResponse>('/metrics/batch', { query: { ...q } });
	}

	systemInfo(): Promise<SystemInfoResponse> {
		return this.request<SystemInfoResponse>('/system/info');
	}

	systemSmart(): Promise<SmartResponse> {
		return this.request<SmartResponse>('/system/smart');
	}

	summary(): Promise<SummaryResponse> {
		return this.request<SummaryResponse>('/summary');
	}

	/** The daemon's own application log (newest-first). */
	logs(q: LogsQuery = {}): Promise<LogsResponse> {
		return this.request<LogsResponse>('/logs', { query: { ...q } });
	}

	listServices(q: ListServicesQuery = {}): Promise<ListServicesResponse> {
		return this.request<ListServicesResponse>('/services', { query: { ...q } });
	}

	getService(name: string): Promise<ServiceDto> {
		return this.request<ServiceDto>(`/services/${encodeURIComponent(name)}`);
	}

	startService(name: string): Promise<ServiceActionResponse> {
		return this.request<ServiceActionResponse>(`/services/${encodeURIComponent(name)}/start`, {
			method: 'POST'
		});
	}
	stopService(name: string): Promise<ServiceActionResponse> {
		return this.request<ServiceActionResponse>(`/services/${encodeURIComponent(name)}/stop`, {
			method: 'POST'
		});
	}
	restartService(name: string): Promise<ServiceActionResponse> {
		return this.request<ServiceActionResponse>(`/services/${encodeURIComponent(name)}/restart`, {
			method: 'POST'
		});
	}
	reloadService(name: string): Promise<ServiceActionResponse> {
		return this.request<ServiceActionResponse>(`/services/${encodeURIComponent(name)}/reload`, {
			method: 'POST'
		});
	}

	enableService(name: string): Promise<ServiceActionResponse> {
		return this.request<ServiceActionResponse>(`/services/${encodeURIComponent(name)}/enable`, {
			method: 'PUT'
		});
	}
	disableService(name: string): Promise<ServiceActionResponse> {
		return this.request<ServiceActionResponse>(`/services/${encodeURIComponent(name)}/disable`, {
			method: 'PUT'
		});
	}

	listTimers(): Promise<ListTimersResponse> {
		return this.request<ListTimersResponse>('/timers');
	}
	enableTimer(name: string): Promise<ServiceActionResponse> {
		return this.request<ServiceActionResponse>(`/timers/${encodeURIComponent(name)}/enable`, {
			method: 'PUT'
		});
	}
	disableTimer(name: string): Promise<ServiceActionResponse> {
		return this.request<ServiceActionResponse>(`/timers/${encodeURIComponent(name)}/disable`, {
			method: 'PUT'
		});
	}

	listCronJobs(): Promise<ListCronJobsResponse> {
		return this.request<ListCronJobsResponse>('/cron');
	}

	listProbes(): Promise<ListProbesResponse> {
		return this.request<ListProbesResponse>('/probes');
	}
	getProbe(name: string): Promise<ProbeDetail> {
		return this.request<ProbeDetail>(`/probes/${encodeURIComponent(name)}`);
	}
	getProbeHistory(name: string, limit?: number, offset?: number): Promise<ProbeHistoryResponse> {
		return this.request<ProbeHistoryResponse>(`/probes/${encodeURIComponent(name)}/history`, {
			query: { limit, offset }
		});
	}
	getProbeMetricHistory(
		probe: string,
		metric: string,
		q: ProbeMetricRangeQuery = {}
	): Promise<ProbeMetricHistoryResponse> {
		return this.request<ProbeMetricHistoryResponse>(
			`/metrics/probe/${encodeURIComponent(probe)}/${encodeURIComponent(metric)}`,
			{ query: { ...q } }
		);
	}
	reloadProbes(): Promise<ReloadProbesResponse> {
		return this.request<ReloadProbesResponse>('/probes/reload', { method: 'POST' });
	}

	processes(query?: Record<string, unknown>): Promise<GetProcessesResponse> {
		return this.request<GetProcessesResponse>('/processes', { query });
	}

	killProcess(pid: number, signal: 9 | 15 = 15): Promise<void> {
		return this.request<void>(`/processes/${pid}`, {
			method: 'DELETE',
			parse: 'none',
			query: { signal }
		});
	}

	dockerStatus(): Promise<DockerStatusResponse> {
		return this.request<DockerStatusResponse>('/docker/status');
	}

	listContainers(): Promise<ListContainersResponse> {
		return this.request<ListContainersResponse>('/docker/containers');
	}

	startContainer(id: string): Promise<DockerActionResponse> {
		return this.request<DockerActionResponse>(`/docker/containers/${id}/start`, { method: 'POST' });
	}

	stopContainer(id: string): Promise<DockerActionResponse> {
		return this.request<DockerActionResponse>(`/docker/containers/${id}/stop`, { method: 'POST' });
	}

	restartContainer(id: string): Promise<DockerActionResponse> {
		return this.request<DockerActionResponse>(`/docker/containers/${id}/restart`, {
			method: 'POST'
		});
	}

	pauseContainer(id: string): Promise<DockerActionResponse> {
		return this.request<DockerActionResponse>(`/docker/containers/${id}/pause`, { method: 'POST' });
	}

	unpauseContainer(id: string): Promise<DockerActionResponse> {
		return this.request<DockerActionResponse>(`/docker/containers/${id}/unpause`, {
			method: 'POST'
		});
	}

	deleteContainer(id: string, force = false): Promise<DockerActionResponse> {
		return this.request<DockerActionResponse>(`/docker/containers/${id}`, {
			method: 'DELETE',
			query: { force: force ? 'true' : 'false' }
		});
	}

	inspectContainer(id: string): Promise<ContainerInspectInfo> {
		// Bypass the GET cache: re-fetched right after lifecycle actions, where a
		// stale "running/stopped" would be wrong.
		return this.request<ContainerInspectInfo>(`/docker/containers/${id}/inspect`, {
			bypassCache: true
		});
	}

	containerLogs(id: string, q: GetContainerLogsRequest = {}): Promise<GetContainerLogsResponse> {
		return this.request<GetContainerLogsResponse>(`/docker/containers/${id}/logs`, {
			query: { tail: q.tail, since: q.since }
		});
	}

	containerStats(id: string): Promise<RawStats> {
		// Bypass the GET cache: polled every couple seconds; stale samples would
		// trip the panel's staleness indicator.
		return this.request<RawStats>(`/docker/containers/${id}/stats`, { bypassCache: true });
	}

	pruneContainers(): Promise<PruneResult> {
		return this.request<PruneResult>('/docker/containers/prune', { method: 'POST' });
	}

	listImages(): Promise<ListImagesResponse> {
		return this.request<ListImagesResponse>('/docker/images');
	}

	deleteImage(id: string, force = false): Promise<DockerActionResponse> {
		return this.request<DockerActionResponse>(`/docker/images/${id}`, {
			method: 'DELETE',
			query: { force: force ? 'true' : 'false' }
		});
	}

	pruneImages(): Promise<PruneResult> {
		return this.request<PruneResult>('/docker/images/prune', { method: 'POST' });
	}

	setFcmToken(token: string | null): Promise<void> {
		return this.request<void>('/me/fcm-token', {
			method: 'PATCH',
			body: { fcm_token: token },
			parse: 'none'
		});
	}

	getVapidPublicKey(): Promise<{ public_key: string }> {
		return this.request<{ public_key: string }>('/push/vapid-public-key');
	}

	subscribePush(req: { endpoint: string; p256dh: string; auth: string }): Promise<void> {
		return this.request<void>('/me/push-subscription', {
			method: 'POST',
			body: req,
			parse: 'none',
			bypassCache: true
		});
	}

	unsubscribePush(): Promise<void> {
		return this.request<void>('/me/push-subscription', {
			method: 'DELETE',
			parse: 'none',
			bypassCache: true
		});
	}

	listSessions(): Promise<ListSessionsResponse> {
		return this.request<ListSessionsResponse>('/me/sessions');
	}

	renameSession(id: string, name: string): Promise<void> {
		return this.request<void>(`/me/sessions/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			body: { name },
			parse: 'none',
			bypassCache: true
		});
	}

	revokeSession(id: string): Promise<void> {
		return this.request<void>(`/me/sessions/${encodeURIComponent(id)}`, {
			method: 'DELETE',
			parse: 'none',
			bypassCache: true
		});
	}

	listAlertRules(): Promise<ListAlertRulesResponse> {
		return this.request<ListAlertRulesResponse>('/alerts');
	}

	createAlertRule(req: CreateAlertRuleRequest): Promise<AlertRuleDto> {
		return this.request<AlertRuleDto>('/alerts', { method: 'POST', body: req });
	}

	getAlertRule(id: number): Promise<AlertRuleDto> {
		return this.request<AlertRuleDto>(`/alerts/${id}`);
	}

	updateAlertRule(id: number, req: UpdateAlertRuleRequest): Promise<AlertRuleDto> {
		return this.request<AlertRuleDto>(`/alerts/${id}`, { method: 'PUT', body: req });
	}

	deleteAlertRule(id: number): Promise<void> {
		return this.request<void>(`/alerts/${id}`, { method: 'DELETE', parse: 'none' });
	}

	/** Mute Fired notifications; evaluator keeps running and Resolved still delivers. */
	silenceAlertRule(id: number, req: SilenceAlertRequest): Promise<AlertRuleDto> {
		return this.request<AlertRuleDto>(`/alerts/${id}/silence`, { method: 'POST', body: req });
	}

	unsilenceAlertRule(id: number): Promise<void> {
		return this.request<void>(`/alerts/${id}/silence`, { method: 'DELETE', parse: 'none' });
	}

	alertState(): Promise<ListAlertStateResponse> {
		return this.request<ListAlertStateResponse>('/alerts/state');
	}

	alertEvents(limit?: number, offset?: number): Promise<ListAlertEventsResponse> {
		return this.request<ListAlertEventsResponse>('/alerts/events', { query: { limit, offset } });
	}

	alertEventsForRule(
		id: number,
		limit?: number,
		offset?: number
	): Promise<ListAlertEventsResponse> {
		return this.request<ListAlertEventsResponse>(`/alerts/${id}/events`, {
			query: { limit, offset }
		});
	}

	alertsSchema(): Promise<AlertsSchemaResponse> {
		return this.request<AlertsSchemaResponse>('/alerts/schema');
	}

	listChannels(): Promise<ListChannelsResponse> {
		return this.request<ListChannelsResponse>('/notifications/channels');
	}

	createChannel(req: CreateChannelRequest): Promise<NotificationChannelResponse> {
		return this.request<NotificationChannelResponse>('/notifications/channels', {
			method: 'POST',
			body: req
		});
	}

	updateChannel(id: number, req: UpdateChannelRequest): Promise<NotificationChannelResponse> {
		return this.request<NotificationChannelResponse>(`/notifications/channels/${id}`, {
			method: 'PUT',
			body: req
		});
	}

	deleteChannel(id: number): Promise<void> {
		return this.request<void>(`/notifications/channels/${id}`, { method: 'DELETE', parse: 'none' });
	}

	testChannel(id: number): Promise<TestChannelResponse> {
		return this.request<TestChannelResponse>(`/notifications/channels/${id}/test`, {
			method: 'POST'
		});
	}

	sseUrl(path: string): string {
		const trimmed = path.startsWith('/') ? path : `/${path}`;
		return `${this.baseUrl}${trimmed.startsWith('/sse/') ? trimmed : '/sse' + trimmed}`;
	}

	wsUrl(path: string): string {
		const trimmed = path.startsWith('/') ? path : `/${path}`;
		const wsBase = this.baseUrl.replace(/^http/, 'ws');
		return `${wsBase}${trimmed.startsWith('/ws/') ? trimmed : '/ws' + trimmed}`;
	}
}

function mergeSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal {
	if (!a) return b!;
	if (!b) return a;
	if (typeof AbortSignal !== 'undefined' && 'any' in AbortSignal) {
		return (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any([a, b]);
	}
	const ctrl = new AbortController();
	const onAbort = () => ctrl.abort();
	a.addEventListener('abort', onAbort, { once: true });
	b.addEventListener('abort', onAbort, { once: true });
	return ctrl.signal;
}
