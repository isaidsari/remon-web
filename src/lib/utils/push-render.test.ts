import { describe, expect, it } from 'bun:test';
import { renderPush, type PushPayload } from './push-render';

const fired: PushPayload = {
	server: 'web-01',
	key: 'alert:7:{}',
	subject: 'high cpu',
	detail: 'cpu.usage_percent = 93',
	severity: 'crit',
	event: 'fired',
	path: '/alerts',
	ref: 'p1'
};

describe('renderPush', () => {
	it('titles by subject and says which server in the reader’s language', () => {
		const r = renderPush(fired, 'tr');
		expect(r.title).toBe('high cpu');
		expect(r.options.body).toBe('Kritik alarm · web-01\ncpu.usage_percent = 93');
		expect(r.options.data).toEqual({ url: '/servers/p1/alerts' });
		expect(r.options.requireInteraction).toBe(true);
	});

	it('lets a resolve quietly replace its fire and leave the firing set', () => {
		const f = renderPush(fired, 'en');
		const r = renderPush({ ...fired, event: 'resolved' }, 'en');
		expect(r.options.tag).toBe(f.options.tag);
		expect(r.options.silent).toBe(true);
		expect(r.options.renotify).toBe(false);
		expect(f.firing).toEqual({ id: 'p1|alert:7:{}', on: true });
		expect(r.firing).toEqual({ id: 'p1|alert:7:{}', on: false });
	});

	it('keeps host events and questions out of the badge', () => {
		expect(renderPush({ ...fired, event: 'host_event' }, 'en').firing).toBeNull();
		expect(renderPush({ ...fired, event: 'action_required' }, 'en').firing).toBeNull();
	});

	it('leaves the detail line out when there is none', () => {
		expect(renderPush({ ...fired, detail: '' }, 'en').options.body).toBe('Critical alert · web-01');
	});

	it('opens the server list when the payload has no ref', () => {
		expect(renderPush({ ...fired, ref: null }, 'en').options.data).toEqual({ url: '/servers' });
	});
});
