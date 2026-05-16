import pkg from '../../package.json';

export const WEB_VERSION = pkg.version as string;

declare const __BUILD_TIME__: number;
export const WEB_BUILT_AT: number =
	typeof __BUILD_TIME__ === 'number' ? __BUILD_TIME__ : 0;
export const WEB_BUILD_MODE: string = import.meta.env.MODE;
