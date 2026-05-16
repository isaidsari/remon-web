// Mirrors is_virtual_interface() in remon-server/src/services/system.rs.
// Client-side copy handles historic metric rows that pre-date server filters
// and enables the physical/container/virtual three-way split (vs server's binary).

export type IfaceClass = 'physical' | 'container' | 'virtual';

export function classifyInterface(name: string): IfaceClass {
	const lower = name.toLowerCase();

	// Container runtimes
	if (/^(veth|docker|br-|cni|cilium|flannel|calico|kube)/.test(name)) return 'container';

	// Loopback — Linux + Windows
	if (name === 'lo' || /^lo\d+$/.test(name)) return 'virtual';
	if (lower.startsWith('loopback pseudo-interface')) return 'virtual';

	// Hypervisor / VM virtual NICs (case-insensitive — Windows TitleCases names)
	if (/^(vethernet|vmnet|vboxnet|virbr|tap\d)/i.test(name)) return 'virtual';
	if (lower.includes('vmware virtual') || lower.includes('virtualbox host-only')) return 'virtual';

	// Packet-capture shadow interfaces (Windows Npcap, occasionally libpcap)
	if (lower.includes('npcap')) return 'virtual';

	// Windows pseudo-tunnels / legacy / WFP
	if (
		lower.includes('wan miniport') ||
		lower.includes('teredo tunneling') ||
		lower.includes('isatap') ||
		lower.includes('wfp lightweight')
	) {
		return 'virtual';
	}

	// macOS auxiliary interfaces — prefix + pure digits
	if (/^(awdl|llw|gif|stf|bridge)\d+$/.test(name)) return 'virtual';

	// Everything else: real NIC + user-meaningful tunnels
	return 'physical';
}

export function isPhysicalInterface(name: string): boolean {
	return classifyInterface(name) === 'physical';
}

export function isContainerMount(path: string): boolean {
	return path.startsWith('/var/lib/docker/') || path.startsWith('/var/lib/containers/');
}
