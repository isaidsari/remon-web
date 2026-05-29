<script lang="ts" module>
	import IconLinux from '~icons/simple-icons/linux';
	import IconApple from '~icons/simple-icons/apple';
	import IconWindows from '~icons/simple-icons/windows11';
	import IconFreebsd from '~icons/simple-icons/freebsd';

	import IconDebian from '~icons/simple-icons/debian';
	import IconUbuntu from '~icons/simple-icons/ubuntu';
	import IconArch from '~icons/simple-icons/archlinux';
	import IconFedora from '~icons/simple-icons/fedora';
	import IconAlpine from '~icons/simple-icons/alpinelinux';
	import IconCentos from '~icons/simple-icons/centos';
	import IconRhel from '~icons/simple-icons/redhat';
	import IconRocky from '~icons/simple-icons/rockylinux';
	import IconAlma from '~icons/simple-icons/almalinux';
	import IconOpensuse from '~icons/simple-icons/suse';
	import IconGentoo from '~icons/simple-icons/gentoo';
	import IconNixos from '~icons/simple-icons/nixos';
	import IconRaspberry from '~icons/simple-icons/raspberrypi';

	import type { Component } from 'svelte';

	export function detectOs(
		os: string | undefined | null,
		version: string | undefined | null
	): { Icon: Component; color: string; label: string } {
		// Backends place distro tokens in either field; concatenate to match regardless.
		const blob = `${os ?? ''} ${version ?? ''}`.toLowerCase();
		const isLinuxFamily =
			blob.includes('linux') ||
			blob.includes('gnu') ||
			blob.includes('debian') ||
			blob.includes('ubuntu') ||
			blob.includes('arch') ||
			blob.includes('fedora') ||
			blob.includes('alpine') ||
			blob.includes('centos') ||
			blob.includes('rhel') ||
			blob.includes('rocky') ||
			blob.includes('alma') ||
			blob.includes('suse') ||
			blob.includes('gentoo') ||
			blob.includes('nixos') ||
			blob.includes('raspbian') ||
			blob.includes('raspberry');

		if (isLinuxFamily) {
			if (blob.includes('debian')) return { Icon: IconDebian, color: '#A81D33', label: 'Debian' };
			if (blob.includes('ubuntu')) return { Icon: IconUbuntu, color: '#E95420', label: 'Ubuntu' };
			if (blob.includes('arch')) return { Icon: IconArch, color: '#1793D1', label: 'Arch' };
			if (blob.includes('fedora')) return { Icon: IconFedora, color: '#51A2DA', label: 'Fedora' };
			if (blob.includes('alpine')) return { Icon: IconAlpine, color: '#0D597F', label: 'Alpine' };
			if (blob.includes('rocky')) return { Icon: IconRocky, color: '#10B981', label: 'Rocky' };
			if (blob.includes('alma')) return { Icon: IconAlma, color: '#0F4266', label: 'AlmaLinux' };
			if (blob.includes('centos')) return { Icon: IconCentos, color: '#262577', label: 'CentOS' };
			if (blob.includes('rhel') || blob.includes('red hat'))
				return { Icon: IconRhel, color: '#EE0000', label: 'RHEL' };
			if (blob.includes('opensuse') || blob.includes('suse'))
				return { Icon: IconOpensuse, color: '#30BA78', label: 'openSUSE' };
			if (blob.includes('gentoo')) return { Icon: IconGentoo, color: '#54487A', label: 'Gentoo' };
			if (blob.includes('nixos')) return { Icon: IconNixos, color: '#5277C3', label: 'NixOS' };
			if (blob.includes('raspbian') || blob.includes('raspberry'))
				return { Icon: IconRaspberry, color: '#A22846', label: 'Raspberry Pi OS' };
			return { Icon: IconLinux, color: '#FCC624', label: 'Linux' };
		}
		if (blob.includes('darwin') || blob.includes('mac os') || blob.includes('macos'))
			return { Icon: IconApple, color: '#A2AAAD', label: 'macOS' };
		if (blob.includes('windows')) return { Icon: IconWindows, color: '#0078D4', label: 'Windows' };
		if (blob.includes('freebsd')) return { Icon: IconFreebsd, color: '#AB2B28', label: 'FreeBSD' };
		return { Icon: IconLinux, color: '#FCC624', label: os || 'unknown' };
	}
</script>

<script lang="ts">
	interface Props {
		os: string | undefined | null;
		version: string | undefined | null;
		class?: string;
		/** Renders with currentColor instead of brand colour. */
		mono?: boolean;
	}

	let { os, version, class: klass = 'size-4', mono = false }: Props = $props();

	let detected = $derived(detectOs(os, version));
</script>

<detected.Icon
	class={klass}
	style={mono ? '' : `color: ${detected.color}`}
	aria-label={detected.label}
/>
