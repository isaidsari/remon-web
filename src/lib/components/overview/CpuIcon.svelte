<script lang="ts" module>
	import IconIntel from '~icons/simple-icons/intel';
	import IconAmd from '~icons/simple-icons/amd';
	import IconApple from '~icons/simple-icons/apple';
	import IconArm from '~icons/simple-icons/arm';
	import IconQemu from '~icons/simple-icons/qemu';
	import IconCpu from '~icons/lucide/cpu';

	import type { Component } from 'svelte';

	export function detectCpu(
		model: string | undefined | null
	): { Icon: Component; color: string; label: string } {
		const m = (model ?? '').toLowerCase();
		if (!m) return { Icon: IconCpu, color: 'currentColor', label: 'CPU' };

		// Apple silicon — string usually has " m1" / " m2" / " m3" with leading space.
		if (
			m.includes('apple') ||
			/\bm[1-4](?:\s|$|\b)/.test(m) ||
			m.includes('apple silicon')
		) {
			return { Icon: IconApple, color: '#A2AAAD', label: 'Apple Silicon' };
		}
		if (m.includes('intel') || m.includes('xeon') || m.includes('core i') || m.includes('pentium') || m.includes('celeron'))
			return { Icon: IconIntel, color: '#0071C5', label: 'Intel' };
		if (m.includes('amd') || m.includes('epyc') || m.includes('ryzen') || m.includes('threadripper') || m.includes('opteron'))
			return { Icon: IconAmd, color: '#ED1C24', label: 'AMD' };
		if (
			m.includes('arm') ||
			m.includes('cortex') ||
			m.includes('neoverse') ||
			m.includes('aarch64') ||
			m.includes('graviton') ||
			m.includes('ampere')
		) {
			return { Icon: IconArm, color: '#0091BD', label: 'ARM' };
		}
		// Hypervisor-only banners. Slightly muted so it's clear this isn't real silicon.
		if (m.includes('qemu') || m.includes('kvm') || m.includes('virtual'))
			return { Icon: IconQemu, color: '#FF6600', label: 'QEMU/KVM' };
		return { Icon: IconCpu, color: 'currentColor', label: 'CPU' };
	}
</script>

<script lang="ts">
	interface Props {
		model: string | undefined | null;
		class?: string;
		mono?: boolean;
	}

	let { model, class: klass = 'size-4', mono = false }: Props = $props();
	let detected = $derived(detectCpu(model));
</script>

<detected.Icon
	class={klass}
	style={mono ? '' : `color: ${detected.color}`}
	aria-label={detected.label}
/>
