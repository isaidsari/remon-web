// Promise-based confirm dialog rendered by <ConfirmDialog /> at root. One at a time; a new call resolves the prior as false.

export type ConfirmVariant = 'info' | 'warning' | 'danger';

export interface ConfirmOptions {
	title: string;
	description?: string;
	confirmLabel?: string;
	cancelLabel?: string;
	variant?: ConfirmVariant;
}

interface ConfirmState extends ConfirmOptions {
	resolve: (ok: boolean) => void;
}

let current = $state<ConfirmState | null>(null);

export function confirm(opts: ConfirmOptions): Promise<boolean> {
	return new Promise((resolve) => {
		// Replace any in-flight dialog: the older callsite gets `false`.
		current?.resolve(false);
		current = { ...opts, resolve };
	});
}

export const confirmStore = {
	get current() {
		return current;
	},
	decide(ok: boolean) {
		current?.resolve(ok);
		current = null;
	}
};
