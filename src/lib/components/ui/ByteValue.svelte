<script lang="ts">
	import { fmtBytes, fmtBytesDetail } from '$lib/utils/format';
	import TweenedNumber from './TweenedNumber.svelte';
	let {
		value,
		label = '',
		digits = 1
	}: { value: number; label?: string; digits?: number } = $props();
	let detail = $derived(`${label ? `${label}: ` : ''}${fmtBytesDetail(value)}`);
</script>

<span title={detail} aria-label={detail}
	><TweenedNumber {value} format={(v) => fmtBytes(v, digits)} /></span
>
