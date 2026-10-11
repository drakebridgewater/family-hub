/**
 * EmDash external auth: sign in to the editor with Authelia instead of
 * EmDash's own passkeys (which are disabled once this is configured).
 *
 * EmDash calls authenticate() on every editor page and private API request.
 * We ask Authelia, as if for /_emdash/admin, so the access_control rule for
 * that path decides who gets in. lldap groups then pick the EmDash role.
 * EmDash matches users by email and creates them on first visit.
 */
import { checkAuthelia } from "./auth";

export interface AutheliaAuthConfig {
	/** [group, EmDash role level]; the highest matching level wins. */
	roleGroups: [string, number][];
	autoProvision?: boolean;
	syncRoles?: boolean;
}

export async function authenticate(request: Request, config: unknown) {
	const { roleGroups } = config as AutheliaAuthConfig;
	const user = await checkAuthelia(request, "/_emdash/admin");
	if (!user) throw new Error("Authelia did not allow this session into the editor");
	if (!user.email) throw new Error(`Authelia user ${user.username} has no email`);

	const role = Math.max(0, ...roleGroups.filter(([g]) => user.groups.includes(g)).map(([, level]) => level));
	if (!role) throw new Error(`Authelia user ${user.username} is in no editor group`);

	return {
		email: user.email,
		name: user.name,
		role,
		subject: user.username,
		metadata: { groups: user.groups },
	};
}
