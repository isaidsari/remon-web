import { RESTING, type MarkStatus, type MarkValues } from './mark';

export const APP_NAME = 'remon';

/** What the browser tab shows: the favicon's fills and lamp, and the title. */
class TabState {
	values = $state<MarkValues>(RESTING);
	status = $state<MarkStatus>('ok');
	title = $state(APP_NAME);
	/** Bumped on every sample from the watched server; the header lamp pings on it. */
	beat = $state(0);
	/** False outside a server, where there is nothing live to show. */
	live = $state(false);

	/** Skips equal readings so the favicon isn't rebuilt on every tick. */
	show(next: MarkValues) {
		if (next.every((v, i) => v === this.values[i])) return;
		this.values = next;
	}

	reset() {
		this.values = RESTING;
		this.status = 'ok';
		this.title = APP_NAME;
		this.live = false;
	}
}

export const tab = new TabState();

/** Rounded to 5 so the favicon is redrawn when the picture changes, not on every jitter. */
export function markValues(
	cpu: number | null,
	mem: number | null,
	disk: number | null
): MarkValues {
	const r = (v: number | null) => (v == null || !Number.isFinite(v) ? 0 : Math.round(v / 5) * 5);
	return [r(cpu), r(mem), r(disk)];
}
