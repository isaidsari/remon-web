<script lang="ts">
	import { untrack } from 'svelte';
	import { tweened } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';

	interface Props {
		value: number | null;
		format?: (v: number) => string;
		/** Tween duration ms; 300 (cubicOut) works for both spiky rate metrics and stable ones. */
		duration?: number;
		placeholder?: string;
		class?: string;
		style?: string;
	}

	let {
		value,
		format = (v) => v.toFixed(1),
		duration = 300,
		placeholder = '—',
		class: klass = '',
		style = ''
	}: Props = $props();

	// duration is a stable init setting; untrack silences the captured-prop warning.
	const tw = tweened(0, { duration: untrack(() => duration), easing: cubicOut });
	// Snap on first value so the display doesn't animate from 0 on page load.
	let primed = $state(false);

	$effect(() => {
		if (value === null) {
			primed = false;
			return;
		}
		if (!primed) {
			tw.set(value, { duration: 0 });
			primed = true;
		} else {
			tw.set(value);
		}
	});
</script>

<span class={klass} {style}>
	{value === null ? placeholder : format($tw)}
</span>
