<script lang="ts">
	import WidgetHost from '$lib/components/dashboard/WidgetHost.svelte';
	import { normalizeConfig } from '$lib/dashboard/config';
	import { WIDGET_META } from '$lib/dashboard/registry';
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { Widget } from '$lib/types/dashboard';
	import UnsupportedPanel from './UnsupportedPanel.svelte';

	interface Props {
		config: unknown;
		path: string;
		conn: Connection;
	}

	let { config, path, conn }: Props = $props();

	// The dashboard grid's cell maths (76px rows, 12px gaps), so a card is as
	// tall here as it is there.
	const ROW_H = 76;
	const GAP = 12;

	let widget = $derived.by<Widget | null>(() => {
		const normalized = normalizeConfig(config);
		if (!normalized) return null;
		const { w, h } = WIDGET_META[normalized.kind].defaultSize;
		return { id: path, x: 0, y: 0, w, h, config: normalized };
	});
	let kind = $derived(
		typeof config === 'object' && config !== null && 'kind' in config
			? String((config as { kind: unknown }).kind)
			: '?'
	);
</script>

{#if widget}
	<div style="height: {widget.h * ROW_H + (widget.h - 1) * GAP}px">
		<WidgetHost {widget} {conn} />
	</div>
{:else}
	<UnsupportedPanel {kind} />
{/if}
