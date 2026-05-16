<script lang="ts">
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import { confirmStore } from '$lib/stores/confirm.svelte';
	import { m } from '$lib/paraglide/messages';

	let cur = $derived(confirmStore.current);

	function cancel() {
		confirmStore.decide(false);
	}
	function confirm() {
		confirmStore.decide(true);
	}
</script>

<Modal
	open={!!cur}
	title={cur?.title}
	description={cur?.description}
	onClose={cancel}
	width="sm"
>
	{#snippet footer()}
		<Button variant="ghost" size="sm" onclick={cancel}>
			{cur?.cancelLabel ?? m.common_cancel()}
		</Button>
		<Button variant={cur?.variant === 'danger' ? 'danger' : 'primary'} size="sm" onclick={confirm}>
			{cur?.confirmLabel ?? m.common_confirm()}
		</Button>
	{/snippet}
</Modal>
