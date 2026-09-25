// Turns raw wikitext into a list of readable blocks. It is intentionally
// lossy: templates, tables and refs vanish so the animation focuses on the
// prose people read, plus the images (inline files, infobox images, galleries).

export type BlockType = 'h2' | 'h3' | 'h4' | 'p' | 'li' | 'img' | 'fact';

export interface Block {
	type: BlockType;
	/** Paragraph text, the caption for images, or the value for infobox facts. */
	text: string;
	/** Normalised file name (no namespace) for image blocks. */
	file?: string;
	/** Infobox row label; '' marks the infobox title row. */
	label?: string;
	/** Indentation level of `:`/`*` lines (talk page threads). */
	depth?: number;
}

const FILE_NS =
	'file|image|datei|bild|fichier|archivo|imagen|immagine|ficheiro|arquivo|plik|bestand|afbeelding|fil|tiedosto|soubor|файл|изображение|ファイル|画像|文件|图像|tập tin|hình';
const FILE_PREFIX = new RegExp(`^\\s*:?\\s*(?:${FILE_NS})\\s*:\\s*`, 'i');
const IMG_EXT = /\.(jpe?g|png|gif|svg|webp|tiff?|bmp|xcf)$/i;
const NON_TEXT_NS =
	/^\s*:?\s*(category|media|kategorie|catégorie|categoría|categoria|kategoria|категория|[a-z]{2,3}(-[a-z]+)?)\s*:/i;
const IMG_OPTION =
	/^(thumb|thumbnail|frame|framed|frameless|border|left|right|center|centre|none|baseline|middle|sub|super|top|text-top|bottom|text-bottom|mini|miniatur|vignette|gauche|droite|centré|links|rechts|zentriert|miniaturadaimagen|upright(\s*=.*)?|hochkant(=.*)?|\d*\s*x?\s*\d+\s*px|(alt|link|class|lang|page|thumbtime|start|end)\s*=.*)$/i;

/** "Image:foo_bar.JPG" → "Foo bar.JPG"; null for non-images (audio, video, pdf…). */
export function normFile(raw: string): string | null {
	const n = decodeEntities(raw).replace(FILE_PREFIX, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
	if (!n || !IMG_EXT.test(n)) return null;
	return n.charAt(0).toUpperCase() + n.slice(1);
}

// Images travel through the text pipeline as marker lines.
const mark = (file: string, caption: string) => `\n\u0001${file}\u0002${caption.replace(/\n/g, ' ')}\u0003\n`;
const MARK_RE = /^\u0001([^\u0002]*)\u0002([^\u0003]*)\u0003$/;
const factMark = (label: string, value: string) => `\n\u0004${label}\u0002${value.replace(/\n/g, ' ')}\u0003\n`;
const FACT_RE = /^\u0004([^\u0002]*)\u0002([^\u0003]*)\u0003$/;

function findClose(s: string, i: number): number {
	let depth = 0;
	let j = i;
	const n = s.length;
	while (j < n) {
		const c = s.charCodeAt(j);
		if (c === 123 /* { */) {
			if (s[j + 1] === '{') {
				depth++;
				j += 2;
				continue;
			}
			if (s[j + 1] === '|' && (j === 0 || s[j - 1] === '\n')) {
				depth++;
				j += 2;
				continue;
			}
		} else if (c === 125 /* } */ && s[j + 1] === '}') {
			depth--;
			j += 2;
			if (depth === 0) return j;
			continue;
		} else if (c === 124 /* | */ && s[j + 1] === '}' && (j === 0 || s[j - 1] === '\n')) {
			depth--;
			j += 2;
			if (depth === 0) return j;
			continue;
		}
		j++;
	}
	return -1;
}

/** Split on `|` at the top level, respecting nested [[ ]] and {{ }}. */
function splitTop(body: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let last = 0;
	for (let i = 0; i < body.length; i++) {
		const two = body.slice(i, i + 2);
		if (two === '[[' || two === '{{') {
			depth++;
			i++;
		} else if ((two === ']]' || two === '}}') && depth > 0) {
			depth--;
			i++;
		} else if (body[i] === '|' && depth === 0) {
			parts.push(body.slice(last, i));
			last = i + 1;
		}
	}
	parts.push(body.slice(last));
	return parts;
}

/** Top-level `key = value` parameters of a template. */
function templateParams(tpl: string): Map<string, string> {
	const parts = splitTop(tpl.slice(2, -2));
	const out = new Map<string, string>();
	for (const p of parts.slice(1)) {
		const eq = p.indexOf('=');
		if (eq > 0) out.set(p.slice(0, eq).trim().toLowerCase(), p.slice(eq + 1).trim());
	}
	return out;
}

const IMG_PARAM = /^(image\d*|logo|photo|image_name|image_file|img|bild|imagen|immagine|image_map|map_image|flag|insignia|seal|cover)$/;
const INFOBOX = /^\{\{\s*(infobox|taxobox|speciesbox|automatic[ _]taxobox|subspeciesbox|chembox|drugbox|geobox|persondata|[^|}]*?\binfobox\b)/i;
const SKIP_PARAM =
	/^(name|title|image\d*|caption\d*|alt\d*|.*_?(size|alt|upright|class|style|ref|footnotes?|caption|image|align|width|height|colou?r|link|lang)\d*|upright|width|module\d*|embed|signature.*|child|subbox|italic.*|bgcolou?r|fossil_range|display_parents|parent_authority|website|.*url|homepage|.*layout|coordinates|coords|map.*|pushpin.*|label_?position|mark|qid|nocat.*|misc|footnote|onlysourced|data\d*|label\d*|header\d*|above|below|bodystyle|type|image_upright|status_system|range_map.*|fetchwikidata|suppressfields|noicons|pronunciation)$/i;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Expand the handful of templates that commonly carry infobox values; drop the rest. */
function expandValue(v: string): string {
	for (let guard = 0; guard < 6 && v.includes('{{'); guard++) {
		const next = v.replace(/\{\{([^{}]*)\}\}/g, (_m, inner: string) => {
			const args = splitTop(inner).map((a) => a.trim());
			const name = args.shift()!.toLowerCase().replace(/_/g, ' ');
			const pos = args.filter((a) => !/^[\w ]+=/.test(a) || a.includes('[['));
			if (/^(birth|death|start|end|film release|release|launch|founding)? ?date( and age)?$|^dts$|^date$/.test(name)) {
				const [y, m, d] = pos.map(Number);
				if (!y) return '';
				return [d || '', m ? MONTHS[m - 1] : '', y].filter(Boolean).join(' ');
			}
			if (/^(age|death year and age|birth year and age)$/.test(name)) return pos[0] ?? '';
			if (/^(convert|cvt)$/.test(name)) return pos.slice(0, 2).join(' ');
			if (/^(ubl|unbulleted list|plainlist|plain list|flatlist|hlist|bulleted list|bulleted|ordered list|collapsible list|marriage|married)$/.test(name))
				return pos.filter((a) => a && !/^\s*$/.test(a)).join(', ');
			if (/^(nowrap|nobr|small|big|nobold|longitem|nowrap begin|sic|lang)$/.test(name)) return pos[pos.length - 1] ?? '';
			if (/^lang-/.test(name) || /^(native name|transl)$/.test(name)) return pos[pos.length - 1] ?? '';
			return '';
		});
		if (next === v) break;
		v = next;
	}
	return stripBalanced(v)
		.replace(new RegExp(`\\[\\[\\s*(?:${FILE_NS})\\s*:[^\\]]*\\]\\]`, 'gi'), '')
		.replace(/<br\s*\/?>/gi, ', ')
		.replace(/^\s*[*#]\s*/gm, ', ')
		.replace(/\n+/g, ' ')
		.replace(/^[\s,]+|[\s,]+$/g, '')
		.replace(/(,\s*){2,}/g, ', ');
}

const humanize = (key: string) => {
	const k = key.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
	return k.charAt(0).toUpperCase() + k.slice(1);
};

/** Turn a template into image markers (any template) and fact rows (infoboxes). */
function templateBlocks(tpl: string): string {
	const isBox = INFOBOX.test(tpl);
	if (!isBox && !/(image|logo|photo|img|bild|imagen|immagine|flag|seal|cover)\d*\s*=/i.test(tpl)) return '';
	const params = templateParams(tpl);
	let out = '';
	if (isBox) {
		const title = expandValue(params.get('name') ?? params.get('title') ?? '');
		if (title) out += factMark('', title);
	}
	for (const [key, value] of params) {
		if (!IMG_PARAM.test(key) || !value) continue;
		const inner = /\[\[([^\]]+)\]\]/.exec(value)?.[1];
		const file = normFile((inner ?? value).split('|')[0]);
		if (!file) continue;
		const n = /\d+$/.exec(key)?.[0] ?? '';
		const caption =
			params.get(`caption${n}`) ??
			params.get(`${key}_caption`) ??
			params.get(`image_caption${n}`) ??
			(key === 'image' ? (params.get('image caption') ?? params.get('legend') ?? '') : '');
		out += mark(file, caption);
	}
	if (isBox) {
		let rows = 0;
		for (const [key, value] of params) {
			if (rows >= 18 || !value || SKIP_PARAM.test(key) || IMG_PARAM.test(key) || /^\d+$/.test(key)) continue;
			const v = expandValue(value);
			if (!v || !/[\p{L}\p{N}]/u.test(v)) continue;
			out += factMark(humanize(key), v);
			rows++;
		}
	}
	return out;
}

/** Remove {{templates}} and {| tables |}, tolerating unbalanced vandalism. */
function stripBalanced(s: string): string {
	let out = '';
	let i = 0;
	let last = 0;
	const n = s.length;
	while (i < n) {
		const c = s.charCodeAt(i);
		if (c === 123 && (s[i + 1] === '{' || (s[i + 1] === '|' && (i === 0 || s[i - 1] === '\n')))) {
			const end = findClose(s, i);
			if (end > 0) {
				out += s.slice(last, i);
				if (s[i + 1] === '{') out += templateBlocks(s.slice(i, end));
				i = last = end;
				continue;
			}
		}
		i++;
	}
	return out + s.slice(last);
}

function fileLink(inner: string): string {
	const parts = inner.split('|');
	const file = normFile(parts[0]);
	if (!file) return '';
	const opts = parts.slice(1).map((p) => p.trim());
	// Tiny inline icons (flags, symbols) are decoration, not article images.
	const size = opts.map((o) => /^(?:\d*x)?(\d+)\s*px$/i.exec(o)).find(Boolean);
	if (size && +size[1] < 60) return '';
	const caption = [...opts].reverse().find((o) => o && !IMG_OPTION.test(o)) ?? '';
	return mark(file, caption);
}

function resolveLinks(s: string): string {
	const re = /\[\[([^[\]]*)\]\]([a-z]*)/g;
	for (let guard = 0; guard < 8 && s.includes('[['); guard++) {
		const next = s.replace(re, (_m, inner: string, suffix: string) => {
			if (FILE_PREFIX.test(inner)) return fileLink(inner) + suffix;
			if (NON_TEXT_NS.test(inner)) return '';
			const bar = inner.lastIndexOf('|');
			const shown = bar >= 0 ? inner.slice(bar + 1) : inner.replace(/^:/, '').replace(/#.*$/, '');
			return (shown || inner.replace(/^[:#]/, '').split('|')[0]) + suffix;
		});
		if (next === s) break;
		s = next;
	}
	return s;
}

function galleries(s: string): string {
	return s.replace(/<gallery\b[^>]*>([\s\S]*?)<\/gallery\s*>/gi, (_m, body: string) => {
		let out = '';
		for (const line of body.split('\n')) {
			const bar = line.indexOf('|');
			const file = normFile(bar >= 0 ? line.slice(0, bar) : line);
			if (file) out += mark(file, bar >= 0 ? line.slice(bar + 1) : '');
		}
		return out;
	});
}

const ENTITIES: Record<string, string> = {
	nbsp: ' ',
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	ndash: '–',
	mdash: '—',
	minus: '−',
	times: '×',
	hellip: '…',
	deg: '°'
};

function decodeEntities(s: string) {
	return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
		if (e[0] === '#') {
			const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
		}
		return ENTITIES[e.toLowerCase()] ?? m;
	});
}

export function wikitextToBlocks(src: string): Block[] {
	let s = src.replace(/\r\n?/g, '\n');
	s = s.replace(/<!--[\s\S]*?(-->|$)/g, '');
	s = s.replace(/<ref\b[^>]*\/>/gi, '');
	s = s.replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>/gi, '');
	s = galleries(s);
	s = s
		.replace(/\{\{\s*(nbsp|space|spaces|thinsp|nbhyph)\s*(\|[^}]*)?\}\}/gi, ' ')
		.replace(/\{\{\s*(snd|spnd|sndash|spaced ndash)\s*\}\}/gi, ' – ')
		.replace(/\{\{\s*(ndash|en dash)\s*\}\}/gi, '–')
		.replace(/\{\{\s*(mdash|em dash)\s*\}\}/gi, '—')
		.replace(/\{\{\s*'\s*\}\}/g, "'");
	s = s.replace(/<(imagemap|timeline|graph|mapframe|references|score|templatedata)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
	s = s.replace(/<references\s*\/>/gi, '');
	s = stripBalanced(s);
	s = resolveLinks(s);
	s = s.replace(/\[(?:https?:)?\/\/[^\s\]]+\s+([^\]]*)\]/g, '$1');
	s = s.replace(/\[(?:https?:)?\/\/[^\s\]]+\]/g, '');
	s = s.replace(/'{2,5}/g, '');
	s = s.replace(/<br\s*\/?>/gi, ' ');
	s = s.replace(/<\/?[a-zA-Z][^>]*>/g, '');
	s = s.replace(/__[A-Z]+__/g, '');
	s = decodeEntities(s);

	const blocks: Block[] = [];
	let para: string[] = [];
	const flush = () => {
		if (para.length) push('p', para.join(' '));
		para = [];
	};
	const push = (type: BlockType, text: string, depth = 0) => {
		const t = text.replace(/\s+/g, ' ').trim();
		if (!t || !/[\p{L}\p{N}]/u.test(t)) return;
		const b: Block = { type, text: t };
		if (depth > 0) b.depth = Math.min(depth, 8);
		blocks.push(b);
	};

	for (const raw of s.split('\n')) {
		const line = raw.trim();
		if (!line) {
			flush();
			continue;
		}
		const fact = FACT_RE.exec(line);
		if (fact) {
			flush();
			const text = fact[2].replace(/\s+/g, ' ').replace(/\s+([,.;])/g, '$1').trim();
			if (text) blocks.push({ type: 'fact', label: fact[1], text });
			continue;
		}
		const img = MARK_RE.exec(line);
		if (img) {
			flush();
			blocks.push({ type: 'img', file: img[1], text: img[2].replace(/\s+/g, ' ').trim() });
			continue;
		}
		const h = /^(={2,6})\s*(.+?)\s*\1\s*$/.exec(line);
		if (h) {
			flush();
			const lvl = h[1].length;
			push(lvl <= 2 ? 'h2' : lvl === 3 ? 'h3' : 'h4', h[2]);
			continue;
		}
		if (/^[*#]/.test(line)) {
			flush();
			const lead = /^[*#:;]+/.exec(line)![0].length;
			push('li', line.replace(/^[*#:;]+\s*/, ''), lead - 1);
			continue;
		}
		if (/^[|!]/.test(line) || /^-{4,}/.test(line) || /^\}\}/.test(line)) continue;
		if (/^[:;]/.test(line)) {
			flush();
			const lead = /^[:;*#]+/.exec(line)![0].length;
			push('p', line.replace(/^[:;*#]+\s*/, ''), lead);
			continue;
		}
		para.push(line);
	}
	flush();
	return blocks;
}
