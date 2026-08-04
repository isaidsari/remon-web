import { createSubscriber } from 'svelte/reactivity';

// The listener is attached only while an effect is reading `tabVisible()`, and
// dropped when the last one stops.
const subscribe = createSubscriber((update) => {
	document.addEventListener('visibilitychange', update);
	return () => document.removeEventListener('visibilitychange', update);
});

/** Reactive `document.visibilityState`. Re-runs the caller when it flips. */
export function tabVisible(): boolean {
	subscribe();
	return document.visibilityState === 'visible';
}
