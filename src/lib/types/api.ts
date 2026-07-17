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
	| 'CONFLICT'
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

/** `GET /health` — liveness. Plain `{ status: 'ok' }`; the process is up and routing. */
export interface HealthResponse {
	status: 'ok';
}

/** `GET /ready` — readiness. 200 with `status: 'ready'` once a DB round-trip
 *  succeeds; the server returns 503 (→ throws here) with `status: 'not_ready'`
 *  and `failed_check: 'db'` while the pool can't serve queries. */
export interface ReadyResponse {
	status: 'ready' | 'not_ready';
	/** Present only on the 503 path. */
	failed_check?: string;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface LogsQuery {
	/** Unix seconds; defaults to `end - 24h`. */
	start?: number;
	/** Unix seconds; defaults to now. */
	end?: number;
	/** Minimum severity to include. Defaults to `trace` (everything persisted). */
	level?: LogLevel;
	/** Hard cap on entries. Defaults to 500, max 5000. */
	limit?: number;
}

export interface LogEntry {
	id: number;
	/** Unix seconds, captured at the emission call site. */
	timestamp: number;
	level: LogLevel;
	/** Emitting app id (the daemon's identifier). */
	source: string;
	/** Rust module path of the emitting call site. */
	target: string;
	message: string;
}

/** `GET /logs` — daemon's own application log. Entries are newest-first. */
export interface LogsResponse {
	entries: LogEntry[];
}

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
	collector_stats_interval_ms: number;
	collector_processes_interval_ms: number;
	rollup_tick_interval_ms: number;
	retention_tick_interval_ms: number;
}

export interface UpdateConfigRequest {
	server_name?: string;
	collector_stats_interval_ms?: number;
	collector_processes_interval_ms?: number;
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
	/** Linux-only: user+nice CPU time as percent of total. */
	user_percent?: number | null;
	/** Linux-only: kernel CPU time (system+irq+softirq) as percent of total. */
	system_percent?: number | null;
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
	total_bytes: number;
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
	total_bytes: number;
	used_bytes: number;
	available_bytes: number;
	read_bytes_per_sec: number;
	write_bytes_per_sec: number;
	/** Linux-only (statvfs): 0..=100. Inodes can run out before bytes do. */
	inode_used_percent?: number | null;
	/** Linux-only (/proc/diskstats): read I/O operations per second. */
	read_iops?: number | null;
	/** Linux-only (/proc/diskstats): write I/O operations per second. */
	write_iops?: number | null;
	/** Linux-only (/proc/diskstats): percent of wall-clock time device had I/O in flight (0..=100). */
	io_util_percent?: number | null;
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

export interface DockerPoint {
	timestamp: number;
	cpu_percent: number;
	memory_used_bytes: number;
	/** 0 when the container has no memory limit. */
	memory_limit_bytes: number;
	/** Byte counters below are cumulative since the container started. */
	network_rx_bytes: number;
	network_tx_bytes: number;
	block_read_bytes: number;
	block_write_bytes: number;
	pids: number;
}

export interface DockerHistoryResponse {
	resolution: MetricsResolution;
	points: DockerPoint[];
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

export type BatchResource = 'cpu' | 'cpu_cores' | 'memory' | 'disk' | 'network' | 'components';

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

export interface SmartDeviceDto {
	device: string;
	model: string | null;
	serial: string | null;
	/** smartctl's overall verdict. false is the headline alarm. */
	health_passed: boolean | null;
	temperature_c: number | null;
	power_on_hours: number | null;
	power_cycles: number | null;
	/** ATA attr 5 — sectors remapped to spares. */
	reallocated_sectors: number | null;
	/** ATA attr 197 — sectors awaiting remap. */
	pending_sectors: number | null;
	/** ATA attr 198 — sectors unreadable even offline. */
	uncorrectable_sectors: number | null;
	/** ATA attr 199 — interface CRC errors; usually cabling. */
	udma_crc_errors: number | null;
	/** NVMe wear indicator 0-100+. */
	percentage_used: number | null;
	available_spare_percent: number | null;
	media_errors: number | null;
	timestamp: number;
}

export interface SmartResponse {
	/** False until collector has confirmed a working smartctl. */
	available: boolean;
	devices: SmartDeviceDto[];
}

export interface SummaryResponse {
	server_name: string;
	hostname: string;
	os: string;
	version: string;
	uptime_secs: number;
	stats_timestamp: number | null;
	cpu_usage_percent: number | null;
	memory_used_bytes: number | null;
	memory_total_bytes: number | null;
	disk_max_used_percent: number | null;
	disk_max_mount: string | null;
	alerts_pending: number;
	alerts_firing: number;
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

// ===== Heartbeats (push dead-man's-switch checks) =====

/** Derived check state, in precedence order. `late` = period elapsed but
 *  still inside grace; `waiting` = never pinged, first window still open. */
export type HeartbeatState = 'disabled' | 'paused' | 'failed' | 'down' | 'waiting' | 'late' | 'up';

/** Operator pauses always outrank service-announced ones. */
export type PauseOrigin = 'operator' | 'service';

export type HeartbeatPingKind = 'success' | 'fail' | 'pause' | 'resume';

export interface HeartbeatCheckDto {
	id: number;
	name: string;
	description: string | null;
	period_secs: number;
	grace_secs: number;
	enabled: boolean;
	/** Derived server-side at read time — same function the alert resolver uses. */
	state: HeartbeatState;
	last_ping_at: number | null;
	last_fail_at: number | null;
	/** When the check flips to `down`, absent further pings or pauses. */
	deadline_at: number;
	paused: boolean;
	/** Pause detail is present only while a pause is active. `null` end = indefinite. */
	paused_until: number | null;
	pause_origin: PauseOrigin | null;
	pause_reason: string | null;
	created_at: number;
	updated_at: number;
}

export interface ListHeartbeatsResponse {
	checks: HeartbeatCheckDto[];
}

export interface CreateHeartbeatRequest {
	name: string;
	description?: string;
	period_secs: number;
	/** Server default: 300. */
	grace_secs?: number;
	enabled?: boolean;
	/** Create under an indefinite operator pause so wiring the pinger up can take its time. */
	paused?: boolean;
}

/** The check fields flattened together with the one-shot slug. */
export interface CreateHeartbeatResponse extends HeartbeatCheckDto {
	/** Shown exactly once — stored hashed server-side, never retrievable again. */
	slug: string;
	/** Server-relative ping URL; prepend the profile base URL. */
	ping_path: string;
}

export interface UpdateHeartbeatRequest {
	name?: string;
	/** Omit = leave as-is; explicit `null` clears. */
	description?: string | null;
	period_secs?: number;
	grace_secs?: number;
	enabled?: boolean;
}

/** Neither field = indefinite (operator-only power). Mutually exclusive. */
export interface PauseHeartbeatRequest {
	until?: number;
	duration_secs?: number;
	reason?: string;
}

export interface HeartbeatSlugDto {
	slug: string;
	ping_path: string;
}

export interface HeartbeatPingDto {
	received_at: number;
	kind: HeartbeatPingKind;
	exit_code: number | null;
	source_ip: string | null;
	user_agent: string | null;
	/** Captured only on fail / nonzero-exit reports, truncated to 4 KiB. */
	body: string | null;
}

export interface ListHeartbeatPingsResponse {
	pings: HeartbeatPingDto[];
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
	steal_percent?: number | null;
	iowait_percent?: number | null;
	guest_percent?: number | null;
	user_percent?: number | null;
	system_percent?: number | null;
	context_switches_per_sec?: number | null;
	process_forks_per_sec?: number | null;
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
	inode_used_percent?: number | null;
	read_iops?: number | null;
	write_iops?: number | null;
	io_util_percent?: number | null;
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
	/** Current working directory. Disambiguates same-named processes; `null`
	 *  for kernel threads or when unreadable (permissions). */
	cwd: string | null;
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

// ===== Incidents =====

/**
 * Manual trigger of the incident flight recorder: freezes the current host
 * context (vitals, top processes, recent errors) as a snapshot the assistant
 * can read back later. Alert transitions capture on their own.
 */
export interface CaptureIncidentRequest {
	/** Why this moment is worth recording (stored, clamped server-side). */
	reason: string;
	/** Defaults to `custom` on the server. */
	category?: 'resource' | 'availability' | 'security' | 'custom';
}

export interface CaptureIncidentResponse {
	id: number;
}

// ===== Assistant =====

export interface AssistantAskRequest {
	question: string;
}

/**
 * A write-action the assistant drafted but did not perform. The client renders
 * it for confirmation and, only on confirm, calls `method path` (with `body`)
 * against the normal REST API.
 */
export interface ProposedAction {
	kind: string;
	summary: string;
	method: 'POST' | 'PUT' | 'DELETE';
	path: string;
	body?: unknown | null;
}

export interface AssistantHistoryTurn {
	question: string;
	answer: string;
}

/** Per-ask dev overrides — honored only when the server has [assistant] dev = true. */
export interface AssistantDevOverrides {
	system?: string;
	model?: string;
	max_steps?: number;
	max_tokens?: number;
	no_tools?: boolean;
	trace?: boolean;
}

/** One loop-trace entry: a model turn (usage/ms) or a tool call (args/result/ms). */
export interface AssistantTraceStep {
	type: 'model' | 'tool';
	step: number;
	ms: number;
	name?: string;
	args?: unknown;
	result_preview?: string;
	usage?: Record<string, number>;
}

export interface AssistantAskResponse {
	answer: string;
	proposals: ProposedAction[];
	trace?: AssistantTraceStep[];
}
