<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import { toMarkdown, type Conversation } from '$lib/assistant/conversation';
	import { toast } from '$lib/stores/toast.svelte';
	import { fmtRelative } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';
	import { m } from '$lib/paraglide/messages';
	import IconPlus from '~icons/lucide/plus';
	import IconCopy from '~icons/lucide/copy';
	import IconTrash from '~icons/lucide/trash-2';

	interface Props {
		conversations: Conversation[];
		activeId: string | null;
		onOpen: (id: string) => void;
		onDelete: (id: string) => void;
		onNew: () => void;
	}

	let { conversations, activeId, onOpen, onDelete, onNew }: Props = $props();

	async function copy(conversation: Conversation) {
		try {
			await navigator.clipboard.writeText(toMarkdown(conversation));
			toast.success(m.assistant_history_exported());
		} catch {
			toast.error(m.assistant_copy_failed());
		}
	}
</script>

<div class="flex max-h-[min(26rem,60dvh)] w-[min(22rem,calc(100vw-2rem))] flex-col">
	<div class="flex items-center justify-between gap-2 px-3 py-2">
		<span class="text-2xs font-medium tracking-wide text-[var(--color-fg-muted)]">
			{m.assistant_history()}
		</span>
		<Button size="sm" variant="ghost" onclick={onNew}>
			<IconPlus class="size-3.5" stroke-width="2" />
			{m.assistant_history_new()}
		</Button>
	</div>

	{#if conversations.length === 0}
		<p class="px-3 pt-1 pb-4 text-xs text-[var(--color-fg-subtle)]">
			{m.assistant_history_empty()}
		</p>
	{:else}
		<ul class="min-h-0 flex-1 overflow-y-auto border-t border-[var(--color-border)] p-1">
			{#each conversations as c (c.id)}
				<li
					class={cn(
						'group flex items-center gap-1 rounded-[var(--radius-input)] pr-1',
						c.id === activeId ? 'bg-[var(--color-surface-2)]' : 'hover:bg-[var(--color-surface-2)]'
					)}
				>
					<button
						type="button"
						onclick={() => onOpen(c.id)}
						class="min-w-0 flex-1 px-2 py-1.5 text-left"
					>
						<span class="block truncate text-xs text-[var(--color-fg)]">{c.title}</span>
						<span class="text-3xs text-[var(--color-fg-subtle)]">
							{fmtRelative(Math.floor(c.updatedAt / 1000))}
						</span>
					</button>
					<!-- Always reachable, not hover-only: touch has no hover. -->
					<Button
						size="icon"
						variant="ghost"
						class="size-7 shrink-0"
						onclick={() => copy(c)}
						aria-label={m.assistant_history_export()}
						title={m.assistant_history_export()}
					>
						<IconCopy class="size-3.5" />
					</Button>
					<Button
						size="icon"
						variant="ghost"
						class="size-7 shrink-0 hover:text-[var(--color-danger)]"
						onclick={() => onDelete(c.id)}
						aria-label={m.assistant_history_delete()}
						title={m.assistant_history_delete()}
					>
						<IconTrash class="size-3.5" />
					</Button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
