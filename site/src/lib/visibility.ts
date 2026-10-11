/**
 * "Family only" posts: a boolean `members_only` field on the posts collection.
 * Anonymous visitors don't see them in the feed and get a sign-in prompt on
 * the post page. Posts made before the field existed have no value = public.
 *
 * Add the field once in EmDash (Content types → Posts → add a Boolean field
 * with slug `members_only`); fresh installs get it from seed/seed.json.
 */
export const MEMBERS_ONLY_FIELD = "members_only";

export function isMembersOnly(post: { data: Record<string, unknown> }): boolean {
	const v = post.data[MEMBERS_ONLY_FIELD];
	return v === true || v === 1 || v === "1" || v === "true";
}
