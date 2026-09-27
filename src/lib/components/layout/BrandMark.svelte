<script lang="ts">
	import { BARE as g, STATUS_COLOR, fillWidth } from '$lib/brand/mark';
	import { tab } from '$lib/brand/tab.svelte';

	let { size = 18 }: { size?: number } = $props();

	let lamp = $derived(STATUS_COLOR[tab.status]);
	let lampY = g.ys[0] + g.h / 2;
</script>

<!-- Same drawing as the favicon; the lamp pings each time the watched server reports. -->
<svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" class="overflow-visible">
	{#each g.ys as y, i (y)}
		<rect x={g.x} {y} width={g.rail} height={g.h} rx={g.rx} fill="currentColor" opacity=".16" />
		<rect
			class="fill"
			x={g.x}
			{y}
			width={fillWidth(g.max, tab.values[i])}
			height={g.h}
			rx={g.rx}
			fill="currentColor"
			opacity={tab.status === 'off' ? 0.3 : 1}
		/>
		{#if i > 0}
			<circle cx={g.led.cx} cy={y + g.h / 2} r={g.led.r} fill="currentColor" opacity=".45" />
		{/if}
	{/each}
	<circle cx={g.led.cx} cy={lampY} r={g.led.r} fill={lamp} />
	{#if tab.live && tab.status !== 'off'}
		{#key tab.beat}
			<circle
				class="ping"
				cx={g.led.cx}
				cy={lampY}
				r={g.led.r}
				fill="none"
				stroke={lamp}
				stroke-width="3"
			/>
		{/key}
	{/if}
</svg>

<style>
	.fill {
		transition: width 900ms var(--ease-snap, ease-out);
	}
	.ping {
		opacity: 0;
		transform-box: fill-box;
		transform-origin: center;
		animation: ping 1100ms ease-out;
	}
	@keyframes ping {
		from {
			opacity: 0.9;
			transform: scale(1);
		}
		to {
			opacity: 0;
			transform: scale(2.6);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.fill {
			transition: none;
		}
		.ping {
			animation: none;
		}
	}
</style>
