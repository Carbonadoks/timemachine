import { error } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { fetchArticle, sanitizeLang, MissingPage, type Article } from '$lib/wiki';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, url, fetch }) => {
	const lang = sanitizeLang(url.searchParams.get('lang'));
	const title = params.title.replace(/_/g, ' ').trim();
	if (!title) error(404, 'No article given');
	try {
		return { title, lang, article: (await fetchArticle(title, lang, fetch)) as Article | null };
	} catch (e) {
		if (e instanceof MissingPage) error(404, e.message);
		// Server-side fetches can get rate limited; let the browser try instead.
		if (!browser) return { title, lang, article: null };
		error(502, (e as Error).message || 'Could not reach Wikipedia');
	}
};
