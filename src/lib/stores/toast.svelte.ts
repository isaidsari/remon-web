export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
	id: string;
	variant: ToastVariant;
	title: string;
	description?: string;
	duration: number;
}

interface ShowOptions {
	description?: string;
	/** Auto-dismiss after this many ms; 0 = stay until dismissed. Default 4500. */
	duration?: number;
}

const DEFAULT_DURATION = 4500;

const toasts = $state<Toast[]>([]);
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function push(variant: ToastVariant, title: string, opts: ShowOptions = {}) {
	const id =
		typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: Math.random().toString(36).slice(2);
	const duration = opts.duration ?? DEFAULT_DURATION;
	const t: Toast = { id, variant, title, description: opts.description, duration };
	toasts.push(t);
	if (duration > 0) {
		timers.set(
			id,
			setTimeout(() => dismiss(id), duration)
		);
	}
	return id;
}

function dismiss(id: string) {
	const t = timers.get(id);
	if (t) {
		clearTimeout(t);
		timers.delete(id);
	}
	const idx = toasts.findIndex((x) => x.id === id);
	if (idx >= 0) toasts.splice(idx, 1);
}

function clearAll() {
	for (const t of timers.values()) clearTimeout(t);
	timers.clear();
	toasts.length = 0;
}

export const toast = {
	get items() {
		return toasts;
	},
	info: (title: string, opts?: ShowOptions) => push('info', title, opts),
	success: (title: string, opts?: ShowOptions) => push('success', title, opts),
	warning: (title: string, opts?: ShowOptions) => push('warning', title, opts),
	error: (title: string, opts?: ShowOptions) => push('error', title, opts),
	dismiss,
	clearAll
};
