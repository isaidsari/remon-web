<script lang="ts">
	import { cn } from '$lib/utils/cn';

	type Status = 'online' | 'offline' | 'unknown' | 'connected';

	interface Props {
		status: Status;
		label?: string;
		class?: string;
	}

	let { status, label, class: klass = '' }: Props = $props();

	const dotClass: Record<Status, string> = {
		online: 'bg-[var(--color-success)]',
		offline: 'bg-[var(--color-danger)]',
		unknown: 'bg-[var(--color-fg-subtle)]',
		connected: 'bg-[var(--color-accent)]'
	};

	const ringClass: Record<Status, string> = {
		online: 'shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-success)_30%,transparent)]',
		offline: '',
		unknown: '',
		connected: 'shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-accent)_30%,transparent)]'
	};

	const defaultLabel: Record<Status, string> = {
		online: 'Online',
		offline: 'Unreachable',
		unknown: 'Checking…',
		connected: 'Connected'
	};
</script>

<span class={cn('inline-flex items-center gap-2 text-xs', klass)}>
	<span class={cn('h-2 w-2 shrink-0 rounded-full', dotClass[status], ringClass[status])}></span>
	<span class="text-[var(--color-fg-muted)]">{label ?? defaultLabel[status]}</span>
</span>
