<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import type { ActionMode } from '$lib/types/api';
	import IconHandshake from '~icons/lucide/handshake';
	import IconZap from '~icons/lucide/zap';
	import IconEye from '~icons/lucide/eye';

	interface Props {
		mode: ActionMode;
		/** When false, an `auto` binding cannot actually run unattended on this
		 *  host — the badge says so rather than implying authority it lacks. */
		autoAllowed?: boolean;
		class?: string;
	}

	let { mode, autoAllowed = true, class: klass = '' }: Props = $props();

	// `auto` is the only one that carries risk, so it is the only one tinted
	// as a warning — and it drops back to muted when the host switch is off.
	let palette = $derived(
		mode === 'auto'
			? autoAllowed
				? 'bg-[var(--color-warning-bg)] text-[var(--color-warning)]'
				: 'bg-[var(--color-surface-2)] text-[var(--color-fg-faint)]'
			: mode === 'dry_run'
				? 'bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]'
				: 'bg-[var(--color-cyan-bg)] text-[var(--color-info)]'
	);

	const icons = { manual: IconHandshake, auto: IconZap, dry_run: IconEye } as const;
	const Icon = $derived(icons[mode]);

	let label = $derived.by(() => {
		switch (mode) {
			case 'manual':
				return m.action_mode_manual();
			case 'auto':
				return autoAllowed ? m.action_mode_auto() : m.action_mode_auto_disarmed();
			case 'dry_run':
				return m.action_mode_dry_run();
		}
	});
</script>

<span
	class={cn(
		'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] tracking-[0.04em] whitespace-nowrap',
		palette,
		klass
	)}
	title={mode === 'auto' && !autoAllowed ? m.action_mode_auto_disarmed_hint() : undefined}
>
	<Icon class="size-[11px]" stroke-width="2.25" />
	{label}
</span>
