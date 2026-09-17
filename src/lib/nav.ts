import type { Component } from 'svelte';
import { m } from '$lib/paraglide/messages';
import IconLayoutDashboard from '~icons/lucide/layout-dashboard';
import IconBotMessageSquare from '~icons/lucide/bot-message-square';
import IconLineChart from '~icons/lucide/line-chart';
import IconList from '~icons/lucide/list';
import IconActivity from '~icons/lucide/activity';
import IconContainer from '~icons/lucide/container';
import IconStethoscope from '~icons/lucide/stethoscope';
import IconHeartPulse from '~icons/lucide/heart-pulse';
import IconTriangleAlert from '~icons/lucide/triangle-alert';
import IconZap from '~icons/lucide/zap';
import IconCamera from '~icons/lucide/camera';
import IconScrollText from '~icons/lucide/scroll-text';
import IconFileText from '~icons/lucide/file-text';
import IconBell from '~icons/lucide/bell';
import IconSettings from '~icons/lucide/settings';
import IconSlidersHorizontal from '~icons/lucide/sliders-horizontal';

export interface NavItem {
	/** Path under `/servers/[id]`; `''` is the overview. */
	path: string;
	label: () => string;
	icon: Component;
}

/** The one list the sidebar and the breadcrumb both read. */
export const NAV_ITEMS: NavItem[] = [
	{ path: '', label: m.section_overview, icon: IconLayoutDashboard },
	{ path: '/assistant', label: m.section_assistant, icon: IconBotMessageSquare },
	{ path: '/metrics', label: m.section_metrics, icon: IconLineChart },
	{ path: '/processes', label: m.section_processes, icon: IconList },
	{ path: '/services', label: m.section_services, icon: IconActivity },
	{ path: '/probes', label: m.section_probes, icon: IconStethoscope },
	{ path: '/heartbeats', label: m.section_heartbeats, icon: IconHeartPulse },
	{ path: '/docker', label: m.section_containers, icon: IconContainer },
	{ path: '/alerts', label: m.section_alerts, icon: IconTriangleAlert },
	{ path: '/actions', label: m.section_actions, icon: IconZap },
	{ path: '/events', label: m.section_events, icon: IconScrollText },
	{ path: '/incidents', label: m.section_incidents, icon: IconCamera },
	{ path: '/logs', label: m.section_logs, icon: IconFileText },
	{ path: '/notifications', label: m.section_notifications, icon: IconBell },
	{ path: '/config', label: m.section_config, icon: IconSettings },
	{ path: '/settings', label: m.section_settings, icon: IconSlidersHorizontal }
];

/** Label for a URL segment under `/servers/[id]`; `overview` is the index. */
export function sectionLabel(slug: string): string {
	const path = slug === 'overview' ? '' : `/${slug}`;
	return NAV_ITEMS.find((item) => item.path === path)?.label() ?? slug;
}
