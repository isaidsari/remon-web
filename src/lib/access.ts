import type { Role } from '$lib/types/api';
import { m } from '$lib/paraglide/messages';

/** Least to most. Mirrors `src/auth/policy.rs` in remon-server, which still decides. */
export const ROLES: readonly Role[] = ['viewer', 'operator', 'admin'];

/** Whether `role` includes everything `need` may do. */
export function atLeast(role: Role, need: Role): boolean {
	return ROLES.indexOf(role) >= ROLES.indexOf(need);
}

export function roleLabel(role: Role): string {
	switch (role) {
		case 'viewer':
			return m.role_viewer();
		case 'operator':
			return m.role_operator();
		case 'admin':
			return m.role_admin();
	}
}

/** One line on what the role may do, for the pairing and device pickers. */
export function roleHint(role: Role): string {
	switch (role) {
		case 'viewer':
			return m.role_viewer_hint();
		case 'operator':
			return m.role_operator_hint();
		case 'admin':
			return m.role_admin_hint();
	}
}
