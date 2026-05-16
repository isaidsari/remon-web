// Locale switching reloads the page — paraglide messages capture locale at
// call time (not reactive), so a reload is the cleanest way to flush caches.
import {
	baseLocale,
	getLocale,
	isLocale,
	locales,
	setLocale
} from '$lib/paraglide/runtime';

export type Locale = (typeof locales)[number];

export const SUPPORTED_LOCALES: readonly Locale[] = locales;
export const DEFAULT_LOCALE: Locale = baseLocale as Locale;

export function currentLocale(): Locale {
	try {
		const l = getLocale();
		return isLocale(l) ? (l as Locale) : DEFAULT_LOCALE;
	} catch {
		return DEFAULT_LOCALE;
	}
}

export function changeLocale(next: Locale): void {
	if (next === currentLocale()) return;
	setLocale(next, { reload: true });
}

export function applyHtmlLang(): void {
	if (typeof document === 'undefined') return;
	document.documentElement.lang = currentLocale();
}

export const LOCALE_LABELS: Record<Locale, string> = {
	en: 'English',
	tr: 'Türkçe'
};
