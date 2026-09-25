// Wiki links travel through the text pipeline as invisible markers
// (\u0015 shown \u0016 target \u0017) and are lifted out into ranges when a
// block is built, so the diff and the animations only ever see plain text.

import { richText } from './math';

export interface Link {
	/** Character range of the link text in the block's `text`. */
	start: number;
	end: number;
	/** Page title, possibly with a #section. */
	target: string;
}

export const LINK_OPEN = '\u0015';
const LINK_SEP = '\u0016';
const LINK_CLOSE = '\u0017';

export const linkMark = (shown: string, target: string) =>
	LINK_OPEN + shown.replace(/[\n\u0015-\u0017]/g, ' ') + LINK_SEP + target.replace(/[\n\u0015-\u0017]/g, '') + LINK_CLOSE;

/** Strip link markers; unbalanced ones (from mangled wikitext) are dropped. */
export function extractLinks(s: string): { text: string; links: Link[] } {
	if (!s.includes(LINK_OPEN) && !s.includes(LINK_SEP)) return { text: s, links: [] };
	let text = '';
	const links: Link[] = [];
	let open = -1;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (c === LINK_OPEN) open = text.length;
		else if (c === LINK_SEP) {
			const close = s.indexOf(LINK_CLOSE, i + 1);
			const target = close < 0 ? '' : s.slice(i + 1, close).trim();
			if (close >= 0) i = close;
			let start = open;
			let end = text.length;
			open = -1;
			if (start < 0 || !target) continue;
			while (start < end && /\s/.test(text[start])) start++;
			while (end > start && /\s/.test(text[end - 1])) end--;
			if (end > start) links.push({ start, end, target });
		} else if (c !== LINK_CLOSE) text += c;
	}
	return { text, links };
}

/** Collapse whitespace like `t.replace(/\s+/g, ' ').trim()` while keeping link ranges aligned. */
export function tidy(raw: string): { text: string; links: Link[] } {
	const { text: t, links } = extractLinks(raw);
	if (!links.length) return { text: t.replace(/\s+/g, ' ').trim(), links };
	// at[i] = where old offset i lands in the collapsed text.
	const at = new Array<number>(t.length + 1);
	let out = '';
	for (let i = 0; i < t.length; i++) {
		at[i] = out.length;
		if (!/\s/.test(t[i])) out += t[i];
		else if (out.length && !/\s/.test(t[i - 1] ?? ' ')) out += ' ';
	}
	at[t.length] = out.length;
	const text = out.trimEnd();
	return {
		text,
		links: links
			.map((l) => ({ ...l, start: at[l.start], end: Math.min(at[l.end], text.length) }))
			.filter((l) => l.end > l.start)
	};
}

export const linkAt = (links: Link[] | undefined, start: number, end: number) =>
	links?.find((l) => l.start < end && l.end > start);

export function linkEl(target: string): HTMLAnchorElement {
	const a = document.createElement('a');
	a.className = 'tm-link';
	a.dataset.target = target;
	a.href = '/wiki/' + encodeURIComponent(target.replace(/#.*$/, '').replace(/ /g, '_')).replace(/%2F/g, '/');
	a.title = target;
	return a;
}

/**
 * `text[from, to)` with its links (in `text` coordinates) as <a data-li> elements,
 * and just-removed links as <span class="tm-unlink" data-ui> so they can animate away.
 */
export function linkedText(text: string, links: Link[] | undefined, from = 0, to = text.length, removed: Link[] = []): Node {
	const frag = document.createDocumentFragment();
	const ranges = [
		...(links ?? []).map((l, i) => ({ l, i, gone: false })),
		...removed.map((l, i) => ({ l, i, gone: true }))
	].sort((x, y) => x.l.start - y.l.start);
	let pos = from;
	for (const { l, i, gone } of ranges) {
		if (l.end <= pos || l.start >= to) continue;
		const s = Math.max(l.start, pos);
		const e = Math.min(l.end, to);
		if (s > pos) frag.append(richText(text.slice(pos, s)));
		let el: HTMLElement;
		if (gone) {
			el = document.createElement('span');
			el.className = 'tm-unlink';
			el.dataset.ui = String(i);
		} else {
			el = linkEl(l.target);
			el.dataset.li = String(i);
		}
		el.append(richText(text.slice(s, e)));
		frag.append(el);
		pos = e;
	}
	if (pos < to) frag.append(richText(text.slice(pos, to)));
	return frag;
}
