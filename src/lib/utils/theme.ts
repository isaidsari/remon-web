
export type ThemeMode = 'auto' | 'light' | 'dark';
const STORAGE_KEY = 'remon.theme';

let mqCleanup: (() => void) | null = null;

function setHtmlTheme(resolved: 'light' | 'dark') {
	document.documentElement.dataset.theme = resolved;
}

export function getTheme(): ThemeMode {
	if (typeof localStorage === 'undefined') return 'auto';
	const v = localStorage.getItem(STORAGE_KEY);
	return v === 'light' || v === 'dark' ? v : 'auto';
}

export function applyTheme(mode: ThemeMode): void {
	if (typeof window === 'undefined') return;
	mqCleanup?.();
	mqCleanup = null;

	if (mode === 'auto') {
		const mq = window.matchMedia('(prefers-color-scheme: light)');
		const handler = () => setHtmlTheme(mq.matches ? 'light' : 'dark');
		handler();
		mq.addEventListener('change', handler);
		mqCleanup = () => mq.removeEventListener('change', handler);
	} else {
		setHtmlTheme(mode);
	}
	try {
		localStorage.setItem(STORAGE_KEY, mode);
	} catch {
		// Private mode etc — silent.
	}
}

/** Resolve to the concrete light/dark value currently applied. */
export function resolvedTheme(): 'light' | 'dark' {
	if (typeof document === 'undefined') return 'dark';
	const v = document.documentElement.dataset.theme;
	return v === 'light' ? 'light' : 'dark';
}
