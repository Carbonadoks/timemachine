// <math> travels through the text pipeline as one opaque token:
// \u000E latex \u000F (inline) or \u0011 latex \u000F (display). KaTeX is
// only downloaded once an article actually contains math.

import type katexType from 'katex';

export const MATH_OPEN = '\u000E';
export const MATH_OPEN_DISPLAY = '\u0011';
export const MATH_CLOSE = '\u000F';
export const MATH_TOKEN = /[\u000E\u0011][^\u000F]*\u000F/;
const MATH_SPLIT = /([\u000E\u0011][^\u000F]*\u000F)/;

export const hasMath = (s: string) => s.includes(MATH_CLOSE);
export const isMath = (t: string) => (t[0] === MATH_OPEN || t[0] === MATH_OPEN_DISPLAY) && t.endsWith(MATH_CLOSE);

// texvc (Wikipedia's math dialect) shorthands KaTeX doesn't know.
const macros: Record<string, string> = {
	'\\and': '\\land',
	'\\or': '\\lor',
	'\\part': '\\partial',
	'\\sgn': '\\operatorname{sgn}',
	'\\arccot': '\\operatorname{arccot}',
	'\\arcsec': '\\operatorname{arcsec}',
	'\\arccsc': '\\operatorname{arccsc}',
	'\\sen': '\\operatorname{sen}',
	'\\bold': '\\mathbf',
	'\\sube': '\\subseteq',
	'\\supe': '\\supseteq',
	'\\Harr': '\\Leftrightarrow',
	'\\harr': '\\leftrightarrow',
	'\\Larr': '\\Leftarrow',
	'\\Rarr': '\\Rightarrow',
	'\\larr': '\\leftarrow',
	'\\rarr': '\\rightarrow',
	'\\uarr': '\\uparrow',
	'\\darr': '\\downarrow',
	'\\hAar': '\\Leftrightarrow',
	'\\lrarr': '\\leftrightarrow',
	'\\thetasym': '\\vartheta',
	'\\image': '\\Im',
	'\\real': '\\Re',
	'\\exist': '\\exists',
	'\\isin': '\\in',
	'\\plusmn': '\\pm',
	'\\sdot': '\\cdot',
	'\\clubs': '\\clubsuit',
	'\\diamonds': '\\diamondsuit',
	'\\hearts': '\\heartsuit',
	'\\spades': '\\spadesuit'
};

let katex: typeof katexType | null = null;
let loading: Promise<void> | null = null;

export function loadMath(): Promise<void> {
	loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')])
		.then(async ([m]) => {
			await import('katex/contrib/mhchem');
			katex = m.default;
		})
		.catch(() => {
			loading = null; // retry next time; until then math shows as source
		});
	return loading;
}

const cache = new Map<string, string>();

function mathEl(token: string): HTMLElement {
	const display = token[0] === MATH_OPEN_DISPLAY;
	// texvc allows align & co. inline; KaTeX only lays them out in display mode.
	const layout = display || /\\begin\{(align|alignat|gather|equation|multline|eqnarray|split)\*?\}/.test(token);
	const tex = token.slice(1, -1);
	const el = document.createElement('span');
	el.className = display ? 'tm-math tm-math-display' : 'tm-math';
	if (!katex) {
		el.textContent = tex;
		el.classList.add('tm-math-src');
		return el;
	}
	const key = (display ? 'D' : 'I') + tex;
	let html = cache.get(key);
	if (html == null) {
		html = katex.renderToString(tex, { displayMode: layout, throwOnError: false, strict: 'ignore', macros: { ...macros } });
		if (cache.size > 2000) cache.clear();
		cache.set(key, html);
	}
	el.innerHTML = html;
	return el;
}

/** Text with any math tokens rendered. */
export function richText(text: string): Node {
	if (!hasMath(text)) return document.createTextNode(text);
	const frag = document.createDocumentFragment();
	text.split(MATH_SPLIT).forEach((part, i) => {
		if (i % 2) frag.append(mathEl(part));
		else if (part) frag.append(part);
	});
	return frag;
}

export function setRichText(el: HTMLElement, text: string) {
	if (hasMath(text)) el.replaceChildren(richText(text));
	else el.textContent = text;
}
