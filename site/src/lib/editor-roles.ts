/**
 * Which lldap groups may write on the hub, and the EmDash role each gets.
 * Used by the Authelia auth hook (astro.config.mjs) and the home page's
 * "New post" button. Levels: 50 admin, 40 editor, 30 author (write and
 * publish own posts), 20 contributor (drafts only).
 */
export const EDITOR_ROLE_GROUPS: [string, number][] = [
	["manage-social", 50],
	["family", 30],
	["extended-family", 20],
];

export const EDITOR_URL = "/_emdash/admin";
export const NEW_POST_URL = `${EDITOR_URL}/content/posts/new`;

export function canPost(groups: string[]): boolean {
	return EDITOR_ROLE_GROUPS.some(([group]) => groups.includes(group));
}
