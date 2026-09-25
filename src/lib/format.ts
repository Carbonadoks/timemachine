const dateFmt = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false });

export const formatDate = (ts: string) => dateFmt.format(new Date(ts));
export const formatDateTime = (ts: string) => `${dateFmt.format(new Date(ts))}, ${timeFmt.format(new Date(ts))}`;
export const formatDelta = (d: number) => (d > 0 ? `+${d.toLocaleString('en')}` : d < 0 ? `−${(-d).toLocaleString('en')}` : '±0');

/** Split "/* Section *\/ did a thing" into its section and plain text; unwrap [[links]]. */
export function cleanComment(c: string) {
	let section = '';
	const text = c
		.replace(/\/\*\s*(.*?)\s*\*\//, (_m, s: string) => {
			section = s;
			return '';
		})
		.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
		.replace(/\s+/g, ' ')
		.replace(/^[\s:–-]+/, '')
		.trim();
	return { section, text };
}

export const isRevert = (c: string) => /\b(revert|reverted|rv|rvv|undid|undo|restor)/i.test(c);

export function userHue(user: string) {
	let hue = 0;
	for (const ch of user) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
	return hue;
}
