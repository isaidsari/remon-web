// DTO mirrors for remon-server public API. Source of truth: remon-server/src/routes/dtos/*.rs

export interface ErrorResponseBody {
	error: {
		code: ApiErrorCode;
		message: string;
	};
}

/** Codes emitted by `remon-server/src/error.rs` (`AppError::into_response`). */
export type ApiErrorCode =
	| 'BAD_REQUEST'
	| 'UNAUTHORIZED'
	| 'INVALID_TOKEN'
	| 'DEVICE_NOT_FOUND'
	| 'DEVICE_INACTIVE'
	| 'NOT_FOUND'
	| 'ALREADY_EXISTS'
	| 'PAIRING_EXPIRED'
	| 'PROCESS_KILL_FAILED'
	| 'DOCKER_ERROR'
	/** 403: caller lacks privilege (systemd needs root / PolicyKit). */
	| 'FORBIDDEN'
	/** 501: operation not implementable on this OS / init backend. */
	| 'NOT_SUPPORTED'
	| 'DOCKER_UNAVAILABLE'
	| 'DATABASE_ERROR'
	| 'INTERNAL_ERROR';

export interface PairingInitiateResponse {
	message: string;
	/** Unix epoch (seconds) at which the pairing window expires. */
	expires_at: number;
}

export interface PairCompleteRequest {
	pairing_code: string;
	device_name: string;
}

export interface PairCompleteResponse {
	device_id: string;
	device_token: string;
}

export interface DeviceLoginRequest {
	device_id: string;
	device_token: string;
}

export interface RefreshRequest {
	refresh_token: string;
}

export interface TokenResponse {
	access_token: string;
	refresh_token: string;
	/** Access-token TTL in seconds. */
	expires_in: number;
}

export interface SessionInfo {
	/** Device id (uuid). */
	id: string;
	/** Operator-friendly name set during pairing or rename. */
	name: string;
	last_ip: string | null;
	/** Unix seconds. */
	last_seen: number;
	/** Unix seconds. */
	created_at: number;
	is_active: boolean;
	has_totp: boolean;
	/** True for the device making the request — UI should tag it as "this device". */
	is_current: boolean;
	/** Non-expired JWT count for this device. 0 means paired but logged out. */
	active_sessions: number;
}

export interface ListSessionsResponse {
	sessions: SessionInfo[];
}

export interface RenameSessionRequest {
	name: string;
}

export interface ConfigResponse {
	server_name: string;
	collector_stats_base_interval_ms: number;
	collector_stats_interval_ms: number;
	collector_processes_interval_ms: number;
	collector_docker_interval_ms: number;
	rollup_tick_interval_ms: number;
	retention_tick_interval_ms: number;
}

export interface UpdateConfigRequest {
	server_name?: string;
	collector_stats_interval_ms?: number;
	collector_processes_interval_ms?: number;
	collector_docker_interval_ms?: number;
	rollup_tick_interval_ms?: number;
	retention_tick_interval_ms?: number;
}

export type MetricsResolution = 'raw' | '1m' | '5m' | '1h';

export interface MetricsRangeQuery {
	start?: number;
	end?: number;
	resolution?: MetricsResolution;
	limit?: number;
}

export interface CpuPoint {
	timestamp: number;
	usage_percent: number;
	load_1m: number;
	load_5m: number;
	load_15m: number;
	/** Linux-only: hypervisor steal time as a percent. Sustained >2-3% on a VPS means host throttling. */
	steal_percent?: number | null;
	/** Linux-only: time spent idle waiting for outstanding disk I/O. */
	iowait_percent?: number | null;
	/** Linux-only: time the kernel ran a guest VM. Non-zero only on hypervisors. */
	guest_percent?: number | null;
	/** Linux-only: kernel-wide context switches per second. */
	context_switches_per_sec?: number | null;
	/** Linux-only: process forks (clone()) per second. Spikes flag restart loops / fork bombs. */
	process_forks_per_sec?: number | null;
}

export interface CpuHistoryResponse {
	resolution: MetricsResolution;
	points: CpuPoint[];
}

export interface CpuCorePoint {
	timestamp: number;
	core_index: number;
	usage_percent: number;
	freq_mhz: number;
}

export interface CpuCoresHistoryResponse {
	resolution: 'raw';
	points: CpuCorePoint[];
}

export interface MemoryPoint {
	timestamp: number;
	used_bytes: number;
	available_bytes: number;
	cached_bytes: number;
	swap_used_bytes: number;
	/** Linux-only: minor page faults per second (cold-page hits, no I/O). */
	page_faults_minor_per_sec?: number | null;
	/** Linux-only: major page faults per second. Sustained > 0 = working set doesn't fit RAM. */
	page_faults_major_per_sec?: number | null;
	/** Linux-only: pages swapped in per second. > 0 sustained = active thrashing. */
	swap_in_pages_per_sec?: number | null;
	/** Linux-only: pages swapped out per second. */
	swap_out_pages_per_sec?: number | null;
}

export interface MemoryHistoryResponse {
	resolution: MetricsResolution;
	points: MemoryPoint[];
}

export interface DiskPoint {
	timestamp: number;
	mount_point: string;
	used_bytes: number;
	available_bytes: number;
	read_bytes_per_sec: number;
	write_bytes_per_sec: number;
	/** Linux-only (statvfs): 0..=100. Inodes can run out before bytes do. */
	inode_used_percent?: number | null;
}

export interface DiskHistoryResponse {
	resolution: MetricsResolution;
	points: DiskPoint[];
}

export interface NetworkPoint {
	timestamp: number;
	interface_name: string;
	rx_bytes_per_sec: number;
	tx_bytes_per_sec: number;
	rx_packets_per_sec: number;
	tx_packets_per_sec: number;
	/** RX-side errors (dropped / rejected frames) per second. Cross-platform; 0 on systems that don't surface it. */
	errors_in_per_sec: number;
	/** TX-side errors per second. Sustained > 0 = bad cable / MTU mismatch / driver bug. */
	errors_out_per_sec: number;
}

export interface NetworkHistoryResponse {
	resolution: MetricsResolution;
	points: NetworkPoint[];
}

export type PressureResource = 'cpu' | 'memory' | 'io';

export interface PressurePoint {
	timestamp: number;
	some_avg10: number;
	some_avg60: number;
	some_avg300: number;
	/** Always 0 for resource='cpu' — kernel doesn't emit it. */
	full_avg10: number;
	full_avg60: number;
	full_avg300: number;
}

export interface PressureHistoryResponse {
	resolution: MetricsResolution;
	resource: PressureResource;
	/** Empty on non-Linux / pre-4.20 kernels. */
	points: PressurePoint[];
}

export interface ComponentPoint {
	timestamp: number;
	label: string;
	temperature_c?: number | null;
	max_c?: number | null;
	critical_c?: number | null;
}

export interface ComponentsHistoryResponse {
	resolution: MetricsResolution;
	/** Often empty on Windows; UI should treat that as "no data", not an error. */
	points: ComponentPoint[];
}

export type BatchResource =
	| 'cpu'
	| 'cpu_cores'
	| 'memory'
	| 'disk'
	| 'network'
	| 'components';

export interface BatchMetricsQuery {
	/** Comma-joined list, e.g. `'cpu,memory,disk'`. Max 8, no dupes. */
	resources: string;
	/** Relative window: `'30m'`, `'1h'`, `'24h'`, `'7d'`, or raw seconds.
	 *  Mutually exclusive with `start`/`end`. */
	span?: string;
	start?: number;
	end?: number;
	resolution?: MetricsResolution;
	limit?: number;
}

export type BatchSeries =
	| { resource: 'cpu'; points: CpuPoint[] }
	| { resource: 'cpu_cores'; points: CpuCorePoint[] }
	| { resource: 'memory'; points: MemoryPoint[] }
	| { resource: 'disk'; points: DiskPoint[] }
	| { resource: 'network'; points: NetworkPoint[] }
	| { resource: 'components'; points: ComponentPoint[] };

export interface BatchMetricsResponse {
	start: number;
	end: number;
	resolution: MetricsResolution;
	/** Order mirrors the request's `resources` list. */
	series: BatchSeries[];
}

export interface SystemDescription {
	hostname: string;
	os: string;
	os_version: string;
	kernel: string;
	uptime_secs: number;
	/** remon-server build version (CARGO_PKG_VERSION). */
	version?: string;
	/** "release" or "debug". */
	build_mode?: string;
	/** Unix seconds when remon-server was built. */
	built_at?: number;
}

export interface HardwareDiskInfo {
	device_name: string;
	mount_point: string;
	fs_type: string;
	total_bytes: number;
	is_removable: boolean;
}

export interface HardwareNetworkInterfaceInfo {
	name: string;
	mac_address: string | null;
	/** Currently always [] — sysinfo doesn't expose IPs; reserved for future enrichment. */
	ip_addresses: string[];
	/** Server-side heuristic on the interface name (veth/docker/br- prefixes today). */
	is_virtual: boolean;
}

export interface HardwareInfo {
	cpu_model: string;
	cpu_cores: number;
	cpu_threads: number;
	total_memory_bytes: number;
	disks: HardwareDiskInfo[];
	network_interfaces: HardwareNetworkInterfaceInfo[];
}

export interface SystemInfoResponse {
	description: SystemDescription;
	hardware: HardwareInfo;
}

export type ServiceState =
	| 'running'
	| 'stopped'
	| 'starting'
	| 'stopping'
	| 'paused'
	| 'failed'
	| 'reloading'
	| 'unknown';

export type ServiceBackend = 'systemd' | 'openrc' | 'windows_scm' | 'unsupported';

export interface ServiceDto {
	name: string;
	description: string | null;
	state: ServiceState;
	/** Backend-specific raw state string (e.g. systemd's "active (running)"). */
	raw_state: string;
	/** Whether the unit is enabled to start at boot. `null` if backend can't tell. */
	enabled_at_boot: boolean | null;
	backend: ServiceBackend;
}

export interface ListServicesResponse {
	services: ServiceDto[];
}

export interface ListServicesQuery {
	state?: ServiceState;
}

export interface ServiceActionResponse {
	success: boolean;
	message: string;
}

export interface TimerDto {
	name: string;
	/** The .service unit this timer triggers. */
	service: string | null;
	description: string | null;
	state: ServiceState;
	raw_state: string;
	enabled_at_boot: boolean | null;
	/** Unix seconds for the next scheduled trigger; null if inactive. */
	next_run: number | null;
	/** Unix seconds for the last trigger; null if never run. */
	last_run: number | null;
}

export interface ListTimersResponse {
	timers: TimerDto[];
}

export interface CronJobDto {
	/** Either a 5-field crontab schedule or a `@daily` / `@hourly` shorthand. */
	schedule: string;
	/** User context for system crontabs; null for per-user crontabs. */
	user: string | null;
	command: string;
	/** Filesystem path the entry was read from (e.g. `/etc/crontab`). */
	source: string;
}

export interface ListCronJobsResponse {
	jobs: CronJobDto[];
}

export interface ProbeMetric {
	name: string;
	value: number;
	unit?: string;
	/** Free-form labels passed through verbatim from the script. */
	labels?: Record<string, string>;
}

export interface ProbeRunDto {
	timestamp: number;
	duration_ms: number;
	/** `null` when the runner killed the child on timeout or spawn failed. */
	exit_code: number | null;
	message: string | null;
	/** `true` iff the runner managed to parse at least one JSON line. */
	parse_ok: boolean;
}

export interface ProbeListEntry {
	name: string;
	description: string | null;
	enabled: boolean;
	/** Server-side cron-like schedule string (e.g. "every 1m"). */
	schedule: string;
	timeout_ms: number;
	last_run_at: number | null;
	last_message: string | null;
	/** `null` until first run; `false` means contract violation. */
	last_parse_ok: boolean | null;
}

export interface ListProbesResponse {
	probes: ProbeListEntry[];
}

export interface ProbeDetail {
	name: string;
	description: string | null;
	enabled: boolean;
	schedule: string;
	timeout_ms: number;
	/** Argv shape — the script command that runs (no shell). */
	command: string[];
	/** Allowed platforms (e.g. ["linux"]). Empty = all. */
	platforms: string[];
	last_run: ProbeRunDto | null;
	/** Metrics from the most recent run; empty until first emission. */
	last_metrics: ProbeMetric[];
}

export interface ProbeHistoryResponse {
	probe_name: string;
	runs: ProbeRunDto[];
}

export interface ProbeMetricPoint {
	timestamp: number;
	labels: Record<string, string>;
	value: number;
}

export interface ProbeMetricHistoryResponse {
	probe_name: string;
	metric_name: string;
	resolution: string;
	points: ProbeMetricPoint[];
}

export interface ProbeMetricRangeQuery {
	start?: number;
	end?: number;
	limit?: number;
	/** Only "raw" is supported server-side today. */
	resolution?: string;
	/** Canonical JSON labels filter, e.g. '{"mount_point":"/"}'. */
	labels?: string;
}

export interface ReloadFailure {
	path: string;
	error: string;
}

export interface ReloadProbesResponse {
	loaded: string[];
	skipped_disabled: string[];
	skipped_platform: string[];
	failed: ReloadFailure[];
}

export interface CoreStats {
	core_index: number;
	usage_percent: number;
	freq_mhz: number;
}

export interface LoadAverage {
	one: number;
	five: number;
	fifteen: number;
}

export interface CpuStats {
	usage_percent: number;
	per_core: CoreStats[];
	load_avg: LoadAverage;
	timestamp: number;
}

export interface MemoryStats {
	total_bytes: number;
	used_bytes: number;
	available_bytes: number;
	cached_bytes: number;
	swap_total_bytes: number;
	swap_used_bytes: number;
	timestamp: number;
}

export interface DiskStats {
	mount_point: string;
	total_bytes: number;
	used_bytes: number;
	available_bytes: number;
	read_bytes_per_sec: number;
	write_bytes_per_sec: number;
	timestamp: number;
}

export interface NetworkStats {
	interface: string;
	rx_bytes_per_sec: number;
	tx_bytes_per_sec: number;
	rx_packets_per_sec: number;
	tx_packets_per_sec: number;
	rx_bytes_total: number;
	tx_bytes_total: number;
	timestamp: number;
}

// PSI snapshot: some_* = any task stalled, full_* = all tasks stalled (always 0 for cpu).
export interface PressureStats {
	some_avg10: number;
	some_avg60: number;
	some_avg300: number;
	full_avg10: number;
	full_avg60: number;
	full_avg300: number;
}

export interface PressureSnapshot {
	cpu: PressureStats | null;
	memory: PressureStats | null;
	io: PressureStats | null;
	timestamp: number;
}

// Live sensor reading; unlike ComponentPoint, timestamp is on the wrapper snapshot.
export interface ComponentInfo {
	label: string;
	temperature_c: number | null;
	max_c: number | null;
	critical_c: number | null;
}

export interface ComponentsSnapshot {
	components: ComponentInfo[];
	timestamp: number;
}

// Serde: { type: 'Cpu', data: CpuStats }. Empty Components frames are dropped server-side.
export type StatsEvent =
	| { type: 'Cpu'; data: CpuStats }
	| { type: 'Memory'; data: MemoryStats }
	| { type: 'Disk'; data: DiskStats[] }
	| { type: 'Network'; data: NetworkStats[] }
	| { type: 'Pressure'; data: PressureSnapshot }
	| { type: 'Components'; data: ComponentsSnapshot };

export type ProcessState = 'running' | 'sleeping' | 'stopped' | 'zombie' | 'idle' | 'unknown';

export interface ProcessInfo {
	pid: number;
	/** PID of the spawning process. `null` for PID 1 and a few kernel-managed
	 *  roots; clients use this to build the process tree. */
	parent_pid: number | null;
	name: string;
	cmd: string[];
	exe: string | null;
	user: string | null;
	cpu_percent: number;
	memory_bytes: number;
	memory_percent: number;
	state: ProcessState;
	started_at: number | null;
	threads: number | null;
}

export interface ProcessQuery {
	search?: string;
	sort?: 'cpu' | 'memory' | 'pid' | 'name';
	limit?: number;
	offset?: number;
}

export interface GetProcessesResponse {
	processes: ProcessInfo[];
	/** Total processes on the system before any filtering. */
	total: number;
	/** Processes matching the current search/state filter. */
	filtered_total: number;
}

export interface DockerStatusResponse {
	available: boolean;
	version: string | null;
	backend: string | null;
	api_version: string | null;
	os: string | null;
	arch: string | null;
}

export interface ContainerInfo {
	id: string;
	names: string[];
	image: string;
	state: string;
	status: string;
	created: number;
}

export interface ListContainersResponse {
	containers: ContainerInfo[];
}

export interface DockerActionResponse {
	success: boolean;
	message: string;
}

export interface ContainerStateInfo {
	status: string | null;
	running: boolean | null;
	paused: boolean | null;
	restarting: boolean | null;
	started_at: string | null;
	finished_at: string | null;
	exit_code: number | null;
	health: string | null;
}

export interface PortMapping {
	container_port: number;
	protocol: string;
	host_port: number | null;
}

export interface NetworkSummary {
	name: string;
	network_id: string | null;
}

export interface ContainerInspectInfo {
	id: string | null;
	name: string | null;
	image: string | null;
	created: string | null;
	state: ContainerStateInfo | null;
	ports: PortMapping[];
	networks: NetworkSummary[];
	restart_count: number | null;
}

export interface GetContainerLogsRequest {
	tail?: number;
	since?: number;
}

export interface GetContainerLogsResponse {
	logs: string[];
}

export interface ImageInfo {
	id: string;
	tags: string[];
	size: number;
	created: number;
}

export interface ListImagesResponse {
	images: ImageInfo[];
}

export interface PruneResult {
	containers_deleted: string[];
	space_reclaimed: number;
}

export type AlertSeverity = 'warn' | 'crit';
export type AlertLifecycle = 'ok' | 'pending' | 'firing';
export type AlertEventType = 'fired' | 'resolved';

export interface AlertRuleDto {
	id: number;
	name: string;
	description: string | null;
	enabled: boolean;
	/** Expression syntax: `<metric_ref> <comparator> <number>` */
	expression: string;
	severity: AlertSeverity;
	/** How long the condition must be true before alerting (seconds). */
	for_duration_secs: number;
	/** How often the evaluator re-checks this rule (seconds, 3–3600). */
	eval_interval_secs: number;
	/** Notification suppression window after a fire (seconds). */
	cooldown_secs: number;
	/** Unix epoch seconds while a silence window is active; `null`
	 *  otherwise. `now < silenced_until` gates Fired notifications;
	 *  Resolved always delivers, evaluator keeps running. */
	silenced_until: number | null;
	created_at: number;
	updated_at: number;
}

export interface ListAlertRulesResponse {
	rules: AlertRuleDto[];
}

export interface CreateAlertRuleRequest {
	name: string;
	description?: string | null;
	enabled?: boolean;
	expression: string;
	severity: AlertSeverity;
	for_duration_secs?: number;
	eval_interval_secs?: number;
	cooldown_secs?: number;
}

export interface UpdateAlertRuleRequest {
	name?: string;
	description?: string | null;
	enabled?: boolean;
	expression?: string;
	severity?: AlertSeverity;
	for_duration_secs?: number;
	eval_interval_secs?: number;
	cooldown_secs?: number;
}

export interface SilenceAlertRequest {
	/** Window length from now. Server clamps to 1..2,592,000 (30 days). */
	duration_secs: number;
}

export interface AlertStateDto {
	rule_id: number;
	rule_name: string;
	severity: AlertSeverity;
	/** Canonical JSON object: `{}` for label-less rules, `{"mount_point":"/"}` etc. */
	label_set: string;
	state: AlertLifecycle;
	state_since: number;
	last_value: number | null;
	last_eval_at: number;
	last_notified_at: number | null;
}

export interface ListAlertStateResponse {
	states: AlertStateDto[];
}

export interface AlertEventDto {
	id: number;
	rule_id: number;
	label_set: string;
	event_type: AlertEventType;
	severity: AlertSeverity;
	occurred_at: number;
	metric_value: number | null;
	notified: boolean;
}

export interface ListAlertEventsResponse {
	events: AlertEventDto[];
}

export interface AlertsSchemaResponse {
	namespaces: NamespaceSchema[];
	comparators: ComparatorSchema[];
}

export interface NamespaceSchema {
	name: string;
	description: string;
	/** When true, metric names are script/runtime-defined (e.g. `probe`); the
	 *  UI should accept any identifier instead of constraining to `metrics`. */
	dynamic_metrics: boolean;
	metrics: MetricSchema[];
	labels: LabelSchema[];
}

export interface MetricSchema {
	name: string;
	unit: string | null;
	description: string | null;
	/** `"float"` | `"int"` | `"bool"` — UI hint for the threshold input. */
	value_type: string;
}

export interface LabelSchema {
	name: string;
	required: boolean;
	/** Fixed enumeration of acceptable values (mutually exclusive with `source`). */
	values?: string[];
	/** REST endpoint + JSON dot-path describing where to fetch valid values
	 *  for autocomplete. `[]` in the path means "iterate the array". */
	source?: LabelSource;
}

export interface LabelSource {
	endpoint: string;
	/** Dot-path with `[]` for array iteration, e.g.
	 *  `"hardware.disks[].mount_point"`. */
	json_path: string;
}

export interface ComparatorSchema {
	op: string;
	display: string;
}

export type NotificationChannelType = 'fcm' | 'telegram' | 'ntfy' | 'webhook' | 'web-push';
export type NotificationMinSeverity = 'warn' | 'crit';

export interface NotificationChannelResponse {
	id: number;
	name: string;
	type: NotificationChannelType;
	enabled: boolean;
	/** Non-sensitive per-channel config (chat_id, url, topic, etc.). No secrets. */
	config: Record<string, unknown>;
	min_severity: NotificationMinSeverity | null;
	created_at: number;
	updated_at: number;
}

export interface ListChannelsResponse {
	channels: NotificationChannelResponse[];
}

export interface CreateChannelRequest {
	name: string;
	type: NotificationChannelType;
	enabled?: boolean;
	config: Record<string, unknown>;
	min_severity?: NotificationMinSeverity | null;
}

export interface UpdateChannelRequest {
	name: string;
	enabled: boolean;
	config: Record<string, unknown>;
	min_severity?: NotificationMinSeverity | null;
}

export interface TestChannelResponse {
	delivered: number;
}
