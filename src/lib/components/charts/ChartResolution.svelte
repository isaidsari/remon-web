<script lang="ts">
	import type { ChartMetadata } from '$lib/types/api';
	import { fmtDuration } from '$lib/utils/format';
	import { m } from '$lib/paraglide/messages';
	let { chart }: { chart?: ChartMetadata } = $props();
	let details = $derived(
		chart
			? [
					m.history_requested_window({
						start: new Date(chart.requested.start * 1000).toLocaleString(),
						end: new Date(chart.requested.end * 1000).toLocaleString()
					}),
					m.history_aligned_window({
						start: new Date(chart.aligned.start * 1000).toLocaleString(),
						end: new Date(chart.aligned.end * 1000).toLocaleString()
					}),
					...(chart.data_through == null
						? []
						: [
								m.history_data_through({
									time: new Date(chart.data_through * 1000).toLocaleString()
								})
							])
				].join('\n')
			: undefined
	);
</script>

<!-- Always takes its line, so the chart does not jump down once metadata arrives. -->
<p class="text-2xs mb-2 min-h-[1.5em] text-[var(--color-fg-subtle)]" title={details}>
	{#if chart}
		{chart.bucket_seconds === 0
			? m.history_raw_samples()
			: m.history_bucket_size({ interval: fmtDuration(chart.bucket_seconds) })}
		{#if chart.unavailable.length > 0}
			· {m.history_missing_coverage()}
		{:else if chart.degraded}
			· {m.history_reduced_detail()}{/if}
	{/if}
</p>
