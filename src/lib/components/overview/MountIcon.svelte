<script lang="ts" module>
	import IconHardDrive from '~icons/lucide/hard-drive';
	import IconChip from '~icons/lucide/cpu';
	import IconFileText from '~icons/lucide/file-text';
	import IconContainer from '~icons/lucide/container';
	import IconZap from '~icons/lucide/zap';
	import IconHome from '~icons/lucide/house';
	import IconSettings from '~icons/lucide/settings';
	import IconUser from '~icons/lucide/user';
	import IconBoot from '~icons/lucide/disc';

	import type { Component } from 'svelte';

	export function detectMount(path: string): { Icon: Component; label: string } {
		const p = path ?? '';
		if (p === '/') return { Icon: IconHardDrive, label: 'root' };
		if (p === '/boot' || p === '/boot/efi') return { Icon: IconBoot, label: 'boot' };
		if (p === '/home' || p.startsWith('/home/')) return { Icon: IconHome, label: 'home' };
		if (p === '/var/log' || p.startsWith('/var/log/')) return { Icon: IconFileText, label: 'logs' };
		if (p.startsWith('/var/lib/docker/') || p.startsWith('/var/lib/containers/'))
			return { Icon: IconContainer, label: 'container layer' };
		if (p === '/dev/shm' || p === '/run' || p.startsWith('/run/')) return { Icon: IconZap, label: 'tmpfs' };
		if (p === '/etc' || p.startsWith('/etc/')) return { Icon: IconSettings, label: 'config' };
		if (p.startsWith('/mnt/') || p.startsWith('/media/'))
			return { Icon: IconHardDrive, label: 'mount' };
		if (p.startsWith('/usr/')) return { Icon: IconUser, label: 'usr' };
		// EFI / firmware-y paths use the chip icon.
		if (p.startsWith('/sys/firmware/')) return { Icon: IconChip, label: 'firmware' };
		return { Icon: IconHardDrive, label: 'mount' };
	}
</script>

<script lang="ts">
	interface Props {
		path: string;
		class?: string;
	}
	let { path, class: klass = 'size-[12px]' }: Props = $props();
	let detected = $derived(detectMount(path));
</script>

<detected.Icon class={klass} aria-label={detected.label} stroke-width="1.75" />
