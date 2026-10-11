/**
 * Categories and tags (EmDash taxonomies) for posts. Both link to the
 * /category/<slug> and /tag/<slug> listings, the same URLs EmDash's menus
 * and widgets generate.
 */
import { getEntryTerms, getTermsForEntries, type TaxonomyTerm } from "emdash";

export const TAXONOMIES = ["category", "tag"] as const;
export type TaxonomyName = (typeof TAXONOMIES)[number];

export interface PostTerms {
	category: TaxonomyTerm[];
	tag: TaxonomyTerm[];
}

const empty = (): PostTerms => ({ category: [], tag: [] });

export async function termsForPosts(ids: string[]): Promise<Map<string, PostTerms>> {
	const out = new Map<string, PostTerms>();
	if (!ids.length) return out;
	const [categories, tags] = await Promise.all(TAXONOMIES.map((t) => getTermsForEntries("posts", ids, t).catch(() => new Map())));
	for (const id of ids) out.set(id, { category: categories.get(id) ?? [], tag: tags.get(id) ?? [] });
	return out;
}

export async function termsForPost(id: string): Promise<PostTerms> {
	try {
		const [category, tag] = await Promise.all(TAXONOMIES.map((t) => getEntryTerms("posts", id, t)));
		return { category, tag };
	} catch {
		return empty();
	}
}
