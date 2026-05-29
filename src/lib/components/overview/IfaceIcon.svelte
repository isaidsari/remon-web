<script lang="ts" module>
	import IconCable from '~icons/lucide/cable';
	import IconWifi from '~icons/lucide/wifi';
	import IconContainer from '~icons/lucide/container';
	import IconNetwork from '~icons/lucide/network';
	import IconShield from '~icons/lucide/shield';
	import IconLoop from '~icons/lucide/repeat';
	import IconRouter from '~icons/lucide/router';

	import type { Component } from 'svelte';

	export function detectIface(name: string): { Icon: Component; label: string } {
		const n = (name ?? '').toLowerCase();
		if (/^(eth|en[ospx])/.test(n)) return { Icon: IconCable, label: 'Ethernet' };
		if (/^wl/.test(n)) return { Icon: IconWifi, label: 'Wi-Fi' };
		if (/^veth/.test(n)) return { Icon: IconContainer, label: 'veth (container)' };
		if (/^docker/.test(n)) return { Icon: IconContainer, label: 'Docker bridge' };
		if (/^br-/.test(n) || n === 'br0') return { Icon: IconRouter, label: 'Bridge' };
		if (/^(cni|cilium|flannel|calico|kube)/.test(n)) return { Icon: IconContainer, label: 'CNI' };
		if (/^(tun|tap|wg|tailscale|zt|nordlynx)/.test(n))
			return { Icon: IconShield, label: 'VPN/tunnel' };
		if (n === 'lo') return { Icon: IconLoop, label: 'loopback' };
		return { Icon: IconNetwork, label: 'interface' };
	}
</script>

<script lang="ts">
	interface Props {
		name: string;
		class?: string;
	}
	let { name, class: klass = 'size-[12px]' }: Props = $props();
	let detected = $derived(detectIface(name));
</script>

<detected.Icon class={klass} aria-label={detected.label} stroke-width="1.75" />
