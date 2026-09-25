// Thin client for the MediaWiki Action API. Everything here runs in the browser
// (CORS via origin=*) except the article fetch, which may also run during SSR.

export interface RevisionMeta {
	revid: number;
	parentid: number;
	timestamp: string;
	user: string;
	comment: string;
	size: number;
	/** Byte delta relative to the previous revision in the list. */
	delta: number;
	minor: boolean;
	anon: boolean;
}

export interface Article {
	title: string;
	displayTitle: string;
	html: string;
	lang: string;
	pageid: number;
	revid: number;
}

const UA = 'WikiTimeMachine/1.0 (Wikipedia history viewer; Cloudflare Pages)';

/** The page genuinely does not exist (as opposed to a network/rate-limit failure). */
export class MissingPage extends Error {}

export function apiBase(lang: string) {
	return `https://${lang}.wikipedia.org/w/api.php`;
}

export function sanitizeLang(lang: string | null | undefined) {
	return lang && /^[a-z-]{2,12}$/.test(lang) ? lang : 'en';
}

async function api(
	lang: string,
	params: Record<string, string>,
	f: typeof fetch = fetch,
	signal?: AbortSignal
) {
	const url = new URL(apiBase(lang));
	for (const [k, v] of Object.entries({
		format: 'json',
		formatversion: '2',
		origin: '*',
		...params
	}))
		url.searchParams.set(k, v);
	const headers: Record<string, string> = {};
	// Browsers refuse a custom UA; only set it when running on the server/worker.
	if (typeof window === 'undefined') headers['User-Agent'] = UA;
	const res = await f(url, { headers, signal });
	if (!res.ok) throw new Error(`Wikipedia API ${res.status}`);
	const json = await res.json();
	if (json.error) {
		const Err = json.error.code === 'missingtitle' || json.error.code === 'invalidtitle' ? MissingPage : Error;
		throw new Err(json.error.info ?? 'Wikipedia API error');
	}
	return json;
}

/** Rewrite links inside parsed HTML so they stay inside the wrapper. */
function rewriteHtml(html: string, lang: string) {
	const q = lang === 'en' ? '' : `?lang=${lang}`;
	return html
		.replace(/href="\/wiki\/([^"#]*)(#[^"]*)?"/g, (_m, page: string, hash = '') => {
			if (/^(Special|Help|Wikipedia|Portal|Talk|Template|Category|File|User)(_talk)?:/i.test(decodeURIComponent(page)))
				return `href="https://${lang}.wikipedia.org/wiki/${page}${hash}" target="_blank" rel="noopener"`;
			return `href="/wiki/${page}${q}${hash}"`;
		})
		.replace(/href="\/w\//g, `target="_blank" rel="noopener" href="https://${lang}.wikipedia.org/w/`)
		.replace(/(src|srcset)="\/\//g, '$1="https://')
		.replace(/(srcset="[^"]*)/g, (m) => m.replace(/, \/\//g, ', https://'));
}

export async function fetchArticle(title: string, lang: string, f: typeof fetch = fetch): Promise<Article> {
	const json = await api(
		lang,
		{
			action: 'parse',
			page: title,
			prop: 'text|displaytitle|revid',
			redirects: '1',
			disableeditsection: '1',
			disabletoc: '1'
		},
		f
	);
	const p = json.parse;
	return {
		title: p.title,
		displayTitle: p.displaytitle,
		html: rewriteHtml(p.text, lang),
		lang,
		pageid: p.pageid,
		revid: p.revid
	};
}

/**
 * Stream the full revision list (oldest first). Calls `onChunk` after each page
 * so the timeline can grow while the rest is still loading.
 */
export async function fetchAllRevisions(
	title: string,
	lang: string,
	onChunk: (all: RevisionMeta[]) => void,
	signal?: AbortSignal
): Promise<RevisionMeta[]> {
	const all: RevisionMeta[] = [];
	let cont: Record<string, string> = {};
	for (;;) {
		const json = await api(
			lang,
			{
				action: 'query',
				prop: 'revisions',
				titles: title,
				redirects: '1',
				rvprop: 'ids|timestamp|user|comment|size|flags',
				rvlimit: 'max',
				rvdir: 'newer',
				...cont
			},
			fetch,
			signal
		);
		const page = json.query?.pages?.[0];
		for (const r of page?.revisions ?? []) {
			const prevSize = all.length ? all[all.length - 1].size : 0;
			all.push({
				revid: r.revid,
				parentid: r.parentid,
				timestamp: r.timestamp,
				user: r.userhidden ? '(hidden user)' : (r.user ?? '?'),
				comment: r.commenthidden ? '(comment hidden)' : (r.comment ?? ''),
				size: r.size ?? prevSize,
				delta: (r.size ?? prevSize) - prevSize,
				minor: !!r.minor,
				anon: !!r.anon
			});
		}
		onChunk(all);
		if (!json.continue) break;
		cont = json.continue;
	}
	return all;
}

/** Fetch wikitext for up to 50 revision ids. Hidden revisions resolve to null. */
export async function fetchRevisionContents(
	revids: number[],
	lang: string,
	signal?: AbortSignal
): Promise<Map<number, string | null>> {
	const out = new Map<number, string | null>();
	let pending = revids.slice(0, 50);
	while (pending.length) {
		const json = await api(
			lang,
			{
				action: 'query',
				prop: 'revisions',
				revids: pending.join('|'),
				rvprop: 'ids|content',
				rvslots: 'main'
			},
			fetch,
			signal
		);
		for (const page of json.query?.pages ?? [])
			for (const r of page.revisions ?? []) out.set(r.revid, r.slots?.main?.content ?? null);
		for (const id of json.query?.badrevids ? Object.keys(json.query.badrevids) : [])
			out.set(Number(id), null);
		// The API may truncate large responses; ask again for whatever is missing.
		const missing = pending.filter((id) => !out.has(id));
		if (missing.length === pending.length) {
			for (const id of missing) out.set(id, null);
			break;
		}
		pending = missing;
	}
	return out;
}

export async function searchTitles(q: string, lang: string, signal?: AbortSignal) {
	const url = `https://${lang}.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(q)}&limit=8`;
	const res = await fetch(url, { signal });
	if (!res.ok) return [];
	const json = await res.json();
	return (json.pages ?? []) as {
		title: string;
		key: string;
		description?: string;
		thumbnail?: { url: string } | null;
	}[];
}

export interface ImgInfo {
	url: string;
	w: number;
	h: number;
}

/**
 * Resolve file names (without namespace) to thumbnail URLs, 50 per request.
 * Files that no longer exist (deleted, never uploaded) map to null.
 */
export async function fetchImageInfo(
	files: string[],
	lang: string,
	signal?: AbortSignal
): Promise<Map<string, ImgInfo | null>> {
	const out = new Map<string, ImgInfo | null>();
	for (let k = 0; k < files.length; k += 50) {
		const chunk = files.slice(k, k + 50);
		const json = await api(
			lang,
			{
				action: 'query',
				titles: chunk.map((f) => `File:${f}`).join('|'),
				prop: 'imageinfo',
				iiprop: 'url|size',
				iiurlwidth: '480',
				redirects: '1'
			},
			fetch,
			signal
		);
		const q = json.query ?? {};
		const alias = new Map<string, string>();
		for (const n of q.normalized ?? []) alias.set(n.from, n.to);
		for (const r of q.redirects ?? []) alias.set(r.from, r.to);
		const pages = new Map<string, { imageinfo?: Record<string, unknown>[] }>(
			(q.pages ?? []).map((p: { title: string }) => [p.title, p])
		);
		for (const f of chunk) {
			let t = `File:${f}`;
			for (let g = 0; g < 3 && alias.has(t); g++) t = alias.get(t)!;
			const ii = pages.get(t)?.imageinfo?.[0] as
				| { thumburl?: string; url?: string; thumbwidth?: number; thumbheight?: number; width?: number; height?: number }
				| undefined;
			const url = ii?.thumburl ?? ii?.url;
			out.set(f, url ? { url, w: ii!.thumbwidth ?? ii!.width ?? 4, h: ii!.thumbheight ?? ii!.height ?? 3 } : null);
		}
	}
	return out;
}
