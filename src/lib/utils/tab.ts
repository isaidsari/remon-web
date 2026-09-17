import { goto } from '$app/navigation';
import { page } from '$app/state';

/** The `?tab=` query parameter, validated against `keys`. Read `current`
 *  inside `$derived`; `set` replaces history so tabs never pile up in it. */
export function tabParam<K extends string>(keys: readonly K[], fallback: K) {
	return {
		get current(): K {
			const raw = page.url.searchParams.get('tab');
			return keys.find((k) => k === raw) ?? fallback;
		},
		set(next: K) {
			const url = new URL(page.url);
			url.searchParams.set('tab', next);
			void goto(url, { replaceState: true, keepFocus: true });
		}
	};
}
