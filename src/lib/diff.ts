import { isMath } from './math';
import type { Block } from './wikitext';

type Edit = [kind: 0 | 1 | 2, ai: number, bi: number]; // 0 = equal, 1 = delete, 2 = insert

/**
 * Myers O(ND) diff with common prefix/suffix trimming. Returns null when the
 * inputs differ too much to diff cheaply; callers fall back to delete+insert.
 */
export function myers<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean = (x, y) => x === y): Edit[] | null {
	let pre = 0;
	while (pre < a.length && pre < b.length && eq(a[pre], b[pre])) pre++;
	let suf = 0;
	while (suf < a.length - pre && suf < b.length - pre && eq(a[a.length - 1 - suf], b[b.length - 1 - suf])) suf++;

	const N = a.length - pre - suf;
	const M = b.length - pre - suf;
	const out: Edit[] = [];
	for (let i = 0; i < pre; i++) out.push([0, i, i]);

	const mid: Edit[] = [];
	if (N === 0) for (let j = 0; j < M; j++) mid.push([2, -1, pre + j]);
	else if (M === 0) for (let i = 0; i < N; i++) mid.push([1, pre + i, -1]);
	else {
		const max = N + M;
		const off = max + 1;
		const width = 2 * max + 2;
		const maxD = Math.min(max, Math.floor(2e7 / width));
		const V = new Int32Array(width);
		const trace: Int32Array[] = [];
		let found = -1;
		outer: for (let d = 0; d <= maxD; d++) {
			trace.push(V.slice());
			for (let k = -d; k <= d; k += 2) {
				let x = k === -d || (k !== d && V[off + k - 1] < V[off + k + 1]) ? V[off + k + 1] : V[off + k - 1] + 1;
				let y = x - k;
				while (x < N && y < M && eq(a[pre + x], b[pre + y])) {
					x++;
					y++;
				}
				V[off + k] = x;
				if (x >= N && y >= M) {
					found = d;
					break outer;
				}
			}
		}
		if (found < 0) return null;
		let x = N;
		let y = M;
		for (let d = found; d >= 0; d--) {
			const T = trace[d];
			const k = x - y;
			const prevK = k === -d || (k !== d && T[off + k - 1] < T[off + k + 1]) ? k + 1 : k - 1;
			const prevX = T[off + prevK];
			const prevY = prevX - prevK;
			while (x > prevX && y > prevY) {
				mid.push([0, pre + x - 1, pre + y - 1]);
				x--;
				y--;
			}
			if (d > 0) {
				if (x === prevX) mid.push([2, -1, pre + y - 1]);
				else mid.push([1, pre + x - 1, -1]);
			}
			x = prevX;
			y = prevY;
		}
		mid.reverse();
	}
	out.push(...mid);
	for (let i = 0; i < suf; i++) out.push([0, a.length - suf + i, b.length - suf + i]);
	return out;
}

// ─── words ────────────────────────────────────────────────────────────────

// A whole <math> token (see math.ts) comes first so it is never split.
const TOKEN_RE = /[\u000E\u0011][^\u000F]*\u000F|[\p{L}\p{N}\p{M}]+(?:['’\-.][\p{L}\p{N}\p{M}]+)*|\s+|[^\s]/gsu;
export const tokenize = (s: string) => s.match(TOKEN_RE) ?? [];
export const isWord = (t: string) => /[\p{L}\p{N}]/u.test(t);

export function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	const m = a.length;
	const n = b.length;
	let prev = Array.from({ length: n + 1 }, (_, j) => j);
	for (let i = 1; i <= m; i++) {
		const cur = [i];
		for (let j = 1; j <= n; j++)
			cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		prev = cur;
	}
	return prev[n];
}

/** Is `b` plausibly a small correction of `a` (typo, case, transposition)? */
export function isTypoFix(a: string, b: string) {
	if (!isWord(a) || !isWord(b) || isMath(a) || isMath(b) || a.length > 30 || b.length > 30) return false;
	if (a.toLowerCase() === b.toLowerCase()) return true;
	const d = levenshtein(a.toLowerCase(), b.toLowerCase());
	const sorted = (s: string) => [...s.toLowerCase()].sort().join('');
	if (sorted(a) === sorted(b)) return true; // anagram → transposition
	return d <= Math.max(1, Math.floor(Math.max(a.length, b.length) * 0.4));
}

export type WordOp =
	| { t: 'eq'; text: string }
	| { t: 'del'; text: string }
	| { t: 'ins'; text: string }
	| { t: 'fix'; from: string; to: string };

export function diffWords(a: string, b: string): WordOp[] {
	const A = tokenize(a);
	const B = tokenize(b);
	const edits = myers(A, B);
	const ops: WordOp[] = [];
	const pushEq = (text: string) => {
		const last = ops[ops.length - 1];
		if (last?.t === 'eq') last.text += text;
		else ops.push({ t: 'eq', text });
	};
	if (!edits) {
		for (const t of A) ops.push({ t: 'del', text: t });
		for (const t of B) ops.push({ t: 'ins', text: t });
		return ops;
	}
	let i = 0;
	while (i < edits.length) {
		if (edits[i][0] === 0) {
			pushEq(A[edits[i][1]]);
			i++;
			continue;
		}
		const dels: string[] = [];
		const ins: string[] = [];
		while (i < edits.length && edits[i][0] !== 0) {
			if (edits[i][0] === 1) dels.push(A[edits[i][1]]);
			else ins.push(B[edits[i][2]]);
			i++;
		}
		// Same shape on both sides and every pair looks like a small correction → typo fixes.
		if (
			dels.length === ins.length &&
			dels.every((d, k) => d === ins[k] || isTypoFix(d, ins[k]) || (!isWord(d) && !isWord(ins[k])))
		) {
			dels.forEach((d, k) => (d === ins[k] ? pushEq(d) : ops.push({ t: 'fix', from: d, to: ins[k] })));
			continue;
		}
		for (const d of dels) ops.push({ t: 'del', text: d });
		for (const n of ins) ops.push({ t: 'ins', text: n });
	}
	return ops;
}

// ─── blocks ───────────────────────────────────────────────────────────────

export type BlockPlan =
	| { kind: 'keep'; from: number; to: number }
	| { kind: 'del'; from: number }
	| { kind: 'ins'; to: number }
	| { kind: 'mod'; from: number; to: number; words: WordOp[] };

function wordSet(s: string) {
	return new Set(tokenize(s.toLowerCase()).filter(isWord));
}

const kind = (b: Block) => (b.type === 'img' || b.type === 'fact' ? b.type : 'text');

/** How alike two blocks are; only blocks of the same kind can pair up as a modification. */
function similarity(x: Block, y: Block) {
	if (kind(x) !== kind(y)) return 0;
	if (x.type === 'img') return x.file === y.file ? 1 : 0.45; // different file → swap in place
	if (x.type === 'fact') return x.label === y.label ? 1 : 0;
	if ((x.depth ?? 0) !== (y.depth ?? 0)) return 0;
	const A = wordSet(x.text);
	const B = wordSet(y.text);
	if (!A.size && !B.size) return 1;
	let common = 0;
	for (const w of A) if (B.has(w)) common++;
	return (2 * common) / (A.size + B.size);
}

export interface Plan {
	items: BlockPlan[];
	wordsAdded: number;
	wordsRemoved: number;
	fixes: number;
	imagesAdded: number;
	imagesRemoved: number;
	imagesSwapped: number;
	changed: boolean;
}

export const blockKey = (b: Block) =>
	[b.type, b.depth ?? 0, b.file ?? '', b.label ?? '', b.text].join('\u0000');

export function planBlocks(prev: Block[], next: Block[]): Plan {
	const pk = prev.map(blockKey);
	const nk = next.map(blockKey);
	const edits = myers(pk, nk) ?? [
		...pk.map((_, i): Edit => [1, i, -1]),
		...nk.map((_, j): Edit => [2, -1, j])
	];

	const items: BlockPlan[] = [];
	let i = 0;
	while (i < edits.length) {
		const e = edits[i];
		if (e[0] === 0) {
			items.push({ kind: 'keep', from: e[1], to: e[2] });
			i++;
			continue;
		}
		const dels: number[] = [];
		const ins: number[] = [];
		while (i < edits.length && edits[i][0] !== 0) {
			if (edits[i][0] === 1) dels.push(edits[i][1]);
			else ins.push(edits[i][2]);
			i++;
		}
		let j = 0;
		for (const d of dels) {
			let best = -1;
			let bestSim = 0.3;
			for (let m = j; m < Math.min(ins.length, j + 16); m++) {
				const s = similarity(prev[d], next[ins[m]]);
				if (s > bestSim) {
					bestSim = s;
					best = m;
				}
			}
			if (best < 0) {
				items.push({ kind: 'del', from: d });
				continue;
			}
			for (; j < best; j++) items.push({ kind: 'ins', to: ins[j] });
			items.push({ kind: 'mod', from: d, to: ins[best], words: diffWords(prev[d].text, next[ins[best]].text) });
			j = best + 1;
		}
		for (; j < ins.length; j++) items.push({ kind: 'ins', to: ins[j] });
	}

	let wordsAdded = 0;
	let wordsRemoved = 0;
	let fixes = 0;
	let imagesAdded = 0;
	let imagesRemoved = 0;
	let imagesSwapped = 0;
	const count = (s: string) => tokenize(s).filter(isWord).length;
	for (const it of items) {
		if (it.kind === 'ins') {
			if (next[it.to].type === 'img') imagesAdded++;
			else wordsAdded += count(next[it.to].text);
		} else if (it.kind === 'del') {
			if (prev[it.from].type === 'img') imagesRemoved++;
			else wordsRemoved += count(prev[it.from].text);
		} else if (it.kind === 'mod') {
			if (prev[it.from].type === 'img' && prev[it.from].file !== next[it.to].file) imagesSwapped++;
			for (const w of it.words) {
				if (w.t === 'ins') wordsAdded += count(w.text);
				else if (w.t === 'del') wordsRemoved += count(w.text);
				else if (w.t === 'fix') fixes++;
			}
		}
	}
	return {
		items,
		wordsAdded,
		wordsRemoved,
		fixes,
		imagesAdded,
		imagesRemoved,
		imagesSwapped,
		changed: items.some((it) => it.kind !== 'keep')
	};
}
