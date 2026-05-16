<script lang="ts">
	import { onMount } from 'svelte';
	import { Terminal } from '@xterm/xterm';
	import { FitAddon } from '@xterm/addon-fit';
	import { WebLinksAddon } from '@xterm/addon-web-links';
	import '@xterm/xterm/css/xterm.css';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { openWsStream, type WsSubscription } from '$lib/api/ws';
	import { cn } from '$lib/utils/cn';
	import type { Connection } from '$lib/stores/connections.svelte';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		conn: Connection;
		containerId: string;
		class?: string;
	}

	let { conn, containerId, class: klass = '' }: Props = $props();

	let cmd = $state('/bin/sh');
	let connected = $state(false);
	let connecting = $state(false);
	let lastCloseInfo = $state<string | null>(null);
	let lastError = $state<string | null>(null);

	let host: HTMLDivElement | null = $state(null);
	let term: Terminal | null = null;
	let fit: FitAddon | null = null;
	let observer: ResizeObserver | null = null;
	let ws: WsSubscription | null = null;

	onMount(() => {
		if (!host) return;
		term = new Terminal({
			cursorBlink: true,
			convertEol: true,
			scrollback: 5000,
			fontFamily:
				'ui-monospace, SFMono-Regular, "JetBrains Mono", "Fira Code", Menlo, Consolas, monospace',
			fontSize: 13,
			lineHeight: 1.2,
			theme: {
				background: '#06070b',
				foreground: '#e5e7eb',
				cursor: '#60a5fa',
				cursorAccent: '#06070b',
				selectionBackground: '#3b82f650',
				black: '#1f2937',
				brightBlack: '#374151',
				red: '#f87171',
				brightRed: '#fca5a5',
				green: '#34d399',
				brightGreen: '#6ee7b7',
				yellow: '#fbbf24',
				brightYellow: '#fcd34d',
				blue: '#60a5fa',
				brightBlue: '#93c5fd',
				magenta: '#f472b6',
				brightMagenta: '#f9a8d4',
				cyan: '#22d3ee',
				brightCyan: '#67e8f9',
				white: '#e5e7eb',
				brightWhite: '#f9fafb'
			}
		});
		fit = new FitAddon();
		term.loadAddon(fit);
		term.loadAddon(new WebLinksAddon());
		term.open(host);
		try {
			fit.fit();
		} catch {
			/* DOM not ready yet — will fit on first observer tick */
		}

		term.onData((data) => {
			ws?.send(data);
		});

		observer = new ResizeObserver(() => {
			try {
				fit?.fit();
			} catch {
				/* container collapsed; ignore */
			}
		});
		observer.observe(host);

		writeInfo(m.terminal_info_ready());

		return () => {
			observer?.disconnect();
			ws?.close();
			term?.dispose();
			term = null;
			fit = null;
			ws = null;
		};
	});

	function writeInfo(line: string) {
		term?.writeln(`\x1b[2;37m▎ ${line}\x1b[0m`);
	}
	function writeWarn(line: string) {
		term?.writeln(`\x1b[2;33m▎ ${line}\x1b[0m`);
	}

	function connect() {
		if (connected || connecting || !term) return;
		const sanitised = cmd.trim();
		if (!sanitised) return;
		connecting = true;
		lastError = null;
		lastCloseInfo = null;

		const url = conn.client.wsUrl(`/docker/containers/${containerId}/exec`);
		ws = openWsStream({
			url,
			getAccessToken: () => conn.accessToken,
			query: { cmd: sanitised, tty: true, stdin: true },
			binaryType: 'arraybuffer',
			handlers: {
				onOpen: () => {
					connecting = false;
					connected = true;
					writeInfo(m.terminal_info_connected({ cmd: sanitised }));
				},
				onMessage: (data) => {
					if (typeof data === 'string') {
						term?.write(data);
					} else if (data instanceof ArrayBuffer) {
						term?.write(new Uint8Array(data));
					} else if (data instanceof Blob) {
						void data.arrayBuffer().then((buf) => term?.write(new Uint8Array(buf)));
					}
				},
				onError: () => {
					lastError = m.terminal_error_websocket();
				},
				onClose: (ev) => {
					connecting = false;
					connected = false;
					ws = null;
					lastCloseInfo = `code ${ev.code}${ev.reason ? ' · ' + ev.reason : ''}`;
					term?.write('\r\n');
					writeWarn(m.terminal_warn_disconnected({ info: lastCloseInfo ?? '' }));
				}
			}
		});
	}

	function disconnect() {
		ws?.close();
	}
</script>

<div class={cn('flex flex-col gap-3', klass)}>
	<div class="flex flex-wrap items-center gap-2">
		<label class="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
			{m.terminal_label_command()}
			<Input
				bind:value={cmd}
				disabled={connected || connecting}
				placeholder="/bin/sh"
				class="w-72 font-mono text-sm"
			/>
		</label>
		{#if !connected && !connecting}
			<Button size="sm" onclick={connect} disabled={!conn.isAuthenticated}>{m.terminal_button_connect()}</Button>
		{:else}
			<Button variant="secondary" size="sm" onclick={disconnect}>{m.terminal_button_disconnect()}</Button>
		{/if}
		{#if connecting}
			<span class="text-xs text-[var(--color-fg-muted)]">{m.terminal_status_opening()}</span>
		{/if}
		<span class="ml-auto text-[10px] tracking-wide text-[var(--color-fg-subtle)]">
			{m.terminal_hint_args()}
		</span>
	</div>

	{#if lastError}
		<p class="text-xs text-[var(--color-danger)]">{lastError}</p>
	{/if}

	<div
		bind:this={host}
		class="h-[480px] rounded-[var(--radius-input)] border border-[var(--color-border)] bg-black p-2"
	></div>
</div>
