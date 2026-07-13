<script lang="ts">
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';

	let { text }: { text: string } = $props();

	// Answers come from the operator's own LLM provider, but they still pass
	// through sanitize: a tool result could echo attacker-influenced strings
	// (process names, log lines) that the model quotes back verbatim.
	const html = $derived(
		DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: true, async: false }) as string)
	);
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized above -->
<div class="md min-w-0">{@html html}</div>

<style>
	/* Compact chat typography on the design tokens; scoped with :global since
	   the children come from {@html}. */
	.md :global(> :first-child) {
		margin-top: 0;
	}
	.md :global(> :last-child) {
		margin-bottom: 0;
	}
	.md :global(p),
	.md :global(ul),
	.md :global(ol),
	.md :global(pre),
	.md :global(table),
	.md :global(blockquote) {
		margin: 0.5rem 0;
	}
	.md :global(ul),
	.md :global(ol) {
		padding-left: 1.25rem;
	}
	.md :global(ul) {
		list-style: disc;
	}
	.md :global(ol) {
		list-style: decimal;
	}
	.md :global(li) {
		margin: 0.15rem 0;
	}
	.md :global(li::marker) {
		color: var(--color-fg-subtle);
	}
	.md :global(strong) {
		font-weight: 600;
	}
	.md :global(h1),
	.md :global(h2),
	.md :global(h3),
	.md :global(h4) {
		margin: 0.75rem 0 0.35rem;
		font-size: 13px;
		font-weight: 600;
	}
	.md :global(a) {
		color: var(--color-accent);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.md :global(code) {
		border-radius: 4px;
		background: var(--color-surface-3);
		padding: 0.1rem 0.3rem;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 11.5px;
	}
	.md :global(pre) {
		overflow-x: auto;
		border-radius: 8px;
		background: var(--color-surface-3);
		padding: 0.6rem 0.75rem;
	}
	.md :global(pre code) {
		background: transparent;
		padding: 0;
	}
	.md :global(blockquote) {
		border-left: 2px solid var(--color-border);
		padding-left: 0.75rem;
		color: var(--color-fg-muted);
	}
	.md :global(table) {
		display: block;
		max-width: 100%;
		overflow-x: auto;
		border-collapse: collapse;
		font-size: 12px;
	}
	.md :global(th),
	.md :global(td) {
		border: 1px solid var(--color-border);
		padding: 0.25rem 0.5rem;
		text-align: left;
	}
	.md :global(th) {
		background: var(--color-surface-3);
		font-weight: 600;
	}
	.md :global(hr) {
		margin: 0.75rem 0;
		border: 0;
		border-top: 1px solid var(--color-border);
	}
</style>
