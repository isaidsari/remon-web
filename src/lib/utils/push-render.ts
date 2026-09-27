// Turns a push payload into the notification the service worker shows.
// Pure, so it runs in the worker and under bun test alike.

type Severity = 'warn' | 'crit';
type PushEvent = 'fired' | 'resolved' | 'host_event' | 'action_required';

/** What remon-server sends; see its notify/channels/webpush.rs. */
export interface PushPayload {
	server: string;
	/** Stable per alert series: a fire and its resolve share it. */
	key: string;
	subject: string;
	detail: string;
	severity: Severity;
	event: PushEvent;
	/** App section, e.g. `/alerts`. */
	path: string;
	/** The profile id this browser registered the server under. */
	ref: string | null;
}

export interface RenderedPush {
	title: string;
	options: NotificationOptions & { renotify?: boolean };
	/** Firing-set id to add (true) or drop (false); null leaves the badge alone. */
	firing: { id: string; on: boolean } | null;
}

const STATUS: Record<'en' | 'tr', Record<string, string>> = {
	en: {
		fired_crit: 'Critical alert',
		fired_warn: 'Warning',
		resolved: 'Resolved',
		host_event_crit: 'Critical host event',
		host_event_warn: 'Host event',
		action_required: 'Waiting for your confirmation'
	},
	tr: {
		fired_crit: 'Kritik alarm',
		fired_warn: 'Uyarı',
		resolved: 'Çözüldü',
		host_event_crit: 'Kritik olay',
		host_event_warn: 'Olay',
		action_required: 'Onayını bekliyor'
	}
};

export function renderPush(data: PushPayload, locale: string): RenderedPush {
	const { event, severity } = data;
	const words = STATUS[locale === 'tr' ? 'tr' : 'en'];
	const status =
		event === 'resolved'
			? words.resolved
			: event === 'action_required'
				? words.action_required
				: event === 'host_event'
					? words[`host_event_${severity}`]
					: words[`fired_${severity}`];
	const tag = `${data.ref ?? data.server}|${data.key}`;
	const body = [`${status} · ${data.server}`, data.detail.trim()].filter(Boolean).join('\n');

	return {
		title: data.subject,
		options: {
			body,
			icon:
				event === 'resolved'
					? '/notify-ok.png'
					: severity === 'warn'
						? '/notify-warn.png'
						: '/notify-crit.png',
			badge: '/badge-96.png',
			// One notification per alert: the resolve quietly replaces its fire.
			tag,
			renotify: event !== 'resolved',
			silent: event === 'resolved',
			requireInteraction: event === 'action_required' || (event === 'fired' && severity === 'crit'),
			data: {
				url: data.ref ? `/servers/${encodeURIComponent(data.ref)}${data.path}` : '/servers'
			}
		},
		firing:
			event === 'fired'
				? { id: tag, on: true }
				: event === 'resolved'
					? { id: tag, on: false }
					: null
	};
}
