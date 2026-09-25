// Imperative animation engine for the history player. Svelte owns the chrome;
// this class owns the article DOM so it can choreograph thousands of
// Web Animations without the framework re-rendering underneath it.

import type { Block } from './wikitext';
import type { Plan, WordOp } from './diff';
import { tokenize, isWord } from './diff';
import { isMath, richText, setRichText } from './math';
import type { ImgInfo } from './wiki';
import type { SfxKind } from './sfx';

type Detail = 'full' | 'words' | 'coarse';

interface Live extends Block {
	el: HTMLElement;
}

interface Job {
	el: HTMLElement;
	anchor: () => HTMLElement;
	measure?: () => void;
	apply?: () => void;
	measure2?: () => void;
	/** Schedules every animation; returns when (base ms) the job is visually done. */
	start: (delay: number) => number;
}

interface AnimOpts {
	duration: number;
	delay?: number;
	easing?: string;
	fill?: FillMode;
	/** What to do once finished: drop the effect, remove the element, or leave it. */
	end?: 'cancel' | 'remove' | 'keep';
	done?: () => void;
}

const EASE_OUT = 'cubic-bezier(.22,1,.36,1)';
const IN_OUT = 'cubic-bezier(.65,0,.35,1)';
const SPRING = 'cubic-bezier(.34,1.56,.64,1)';
const PUSH = 'cubic-bezier(.3,1.25,.5,1)';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function h(tag: string, cls: string, text?: string) {
	const e = document.createElement(tag);
	e.className = cls;
	if (text != null) e.append(richText(text));
	return e;
}

function splitLetters(span: HTMLElement, text: string) {
	for (const ch of text) span.append(h('span', 'ch', ch));
	return [...span.children] as HTMLElement[];
}

/** Parabolic "toss and fall" keyframes. */
function gravity(dx: number, fall: number, rot: number, lift = 26): Keyframe[] {
	const frames: Keyframe[] = [];
	for (let i = 0; i <= 8; i++) {
		const s = i / 8;
		const y = -lift * 2 * s + (fall + lift * 2) * s * s;
		frames.push({
			transform: `translate(${dx * s}px, ${y}px) rotate(${rot * s}deg)`,
			opacity: s < 0.55 ? 1 : 1 - (s - 0.55) / 0.45,
			offset: s
		});
	}
	return frames;
}

/** Letter correspondence for a typo fix: LCS first, then nearest same-letter hops. */
function matchLetters(a: string[], b: string[]) {
	const m = a.length;
	const n = b.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
	for (let i = m - 1; i >= 0; i--)
		for (let j = n - 1; j >= 0; j--)
			dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
	const match = new Array<number>(n).fill(-1);
	const hop = new Array<boolean>(n).fill(false);
	const used = new Array<boolean>(m).fill(false);
	for (let i = 0, j = 0; i < m && j < n; ) {
		if (a[i] === b[j]) {
			match[j] = i;
			used[i] = true;
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
		else j++;
	}
	for (let j = 0; j < n; j++) {
		if (match[j] >= 0) continue;
		let best = -1;
		for (let i = 0; i < m; i++)
			if (!used[i] && a[i].toLowerCase() === b[j].toLowerCase() && (best < 0 || Math.abs(i - j) < Math.abs(best - j)))
				best = i;
		if (best >= 0) {
			match[j] = best;
			used[best] = true;
			hop[j] = a[best] === b[j];
		}
	}
	return { match, hop, used };
}

export class Stage {
	speed = 1;
	/** Resolved thumbnails, shared with the history controller (null = file deleted). */
	images = new Map<string, ImgInfo | null>();
	/** Sound cue hook: (kind, real delay in ms). Unset = silent. */
	onSound?: (kind: SfxKind, delayMs: number) => void;
	private blocks: Live[] = [];
	private dirty: Live[] = [];
	private doomed = new Set<Element>();
	private running = new Set<Animation>();
	private timers = new Set<ReturnType<typeof setTimeout>>();
	private gen = 0;
	private cursor: HTMLElement;
	private cursorName: HTMLElement;
	private col = { text: '#222', ins: '#1a7f37', insBg: 'rgba(40,180,90,.2)', del: '#cf222e', fix: 'rgba(255,200,0,.55)', spark: '#f5a623' };

	constructor(
		private root: HTMLElement,
		private content: HTMLElement
	) {
		this.cursor = h('div', 'edit-cursor');
		this.cursor.append(h('i', 'edit-caret'));
		this.cursorName = h('span', 'edit-name');
		this.cursor.append(this.cursorName);
		this.content.append(this.cursor);
		this.readColors();
	}

	readColors() {
		const cs = getComputedStyle(this.content);
		const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
		this.col = {
			text: v('--tm-text', this.col.text),
			ins: v('--tm-ins', this.col.ins),
			insBg: v('--tm-ins-bg', this.col.insBg),
			del: v('--tm-del', this.col.del),
			fix: v('--tm-fix', this.col.fix),
			spark: v('--tm-spark', this.col.spark)
		};
	}

	private ms(x: number) {
		return x / this.speed;
	}

	/** Cue a sound `base` ms (animation time) from now. */
	private sound(kind: SfxKind, base: number) {
		this.onSound?.(kind, this.ms(base));
	}

	private anim(target: Element, frames: Keyframe[], o: AnimOpts) {
		const a = target.animate(frames, {
			duration: Math.max(1, this.ms(o.duration)),
			delay: this.ms(o.delay ?? 0),
			easing: o.easing ?? EASE_OUT,
			fill: o.fill ?? 'both'
		});
		this.running.add(a);
		a.finished.then(
			() => {
				this.running.delete(a);
				o.done?.();
				if (o.end === 'remove') target.remove();
				else if (o.end !== 'keep') a.cancel();
			},
			() => this.running.delete(a)
		);
		return a;
	}

	private later(base: number, fn: () => void) {
		const t = setTimeout(() => {
			this.timers.delete(t);
			fn();
		}, this.ms(base));
		this.timers.add(t);
	}

	/** Remove `el` once its exit animation is over (or at the next settle). */
	private doom(el: Element, base: number) {
		this.doomed.add(el);
		this.later(base, () => {
			this.doomed.delete(el);
			el.remove();
		});
	}

	/** Resolves true if the stage was not cancelled while waiting. */
	private wait(base: number) {
		const g = this.gen;
		return new Promise<boolean>((resolve) => {
			const t = setTimeout(() => {
				this.timers.delete(t);
				resolve(g === this.gen);
			}, this.ms(base));
			this.timers.add(t);
		});
	}

	/** Stop everything immediately. Callers follow up with renderStatic(). */
	cancel() {
		this.gen++;
		for (const a of [...this.running]) a.cancel();
		this.running.clear();
		for (const t of this.timers) clearTimeout(t);
		this.timers.clear();
		this.cursor.classList.remove('on');
	}

	renderStatic(blocks: Block[]) {
		this.cancel();
		for (const el of [...this.content.children]) if (el !== this.cursor) el.remove();
		this.blocks = blocks.map((b) => {
			const el = h('div', '');
			this.renderBlock(el, b);
			this.content.insertBefore(el, this.cursor);
			return { ...b, el };
		});
		this.dirty = [];
		this.doomed.clear();
	}

	/** Collapse token spans from the previous edit back into plain text. */
	private settle() {
		for (const el of this.doomed) el.remove();
		this.doomed.clear();
		for (const b of this.dirty) {
			if (!b.el.isConnected) continue;
			// Images keep their <img> (no reload flicker); only the text is reset.
			setRichText(this.textBox(b.el), b.text);
			b.el.removeAttribute('style');
			b.el.querySelector('figure')?.removeAttribute('style');
			b.el.className = this.blockClass(b);
		}
		this.dirty = [];
	}

	private blockClass(b: Block) {
		let c = `blk blk-${b.type}`;
		if (b.depth) c += ` d${b.depth}`;
		if (b.type === 'fact' && !b.label) c += ' fact-title';
		return c;
	}

	/** Build a block's DOM; returns the element holding its text (paragraph, caption or fact value). */
	private renderBlock(el: HTMLElement, b: Block): HTMLElement {
		el.className = this.blockClass(b);
		el.textContent = '';
		if (b.type === 'img') {
			const fig = h('figure', 'tm-fig');
			const cap = h('figcaption', 'tm-cap', b.text);
			fig.append(this.frame(b.file!), cap);
			el.append(fig);
			return cap;
		}
		if (b.type === 'fact') {
			if (b.label) el.append(h('span', 'fact-label', b.label));
			const v = h('span', 'fact-value', b.text);
			el.append(v);
			return v;
		}
		setRichText(el, b.text);
		return el;
	}

	private frame(file: string) {
		const info = this.images.get(file);
		const f = h('div', 'tm-frame');
		if (info) {
			const img = document.createElement('img');
			img.src = info.url;
			img.alt = '';
			img.decoding = 'async';
			f.style.aspectRatio = `${info.w} / ${info.h}`;
			f.append(img);
		} else {
			f.classList.add('missing');
			f.append(h('span', 'miss-name', file), h('span', 'miss-note', info === null ? 'file no longer exists' : 'image unavailable'));
		}
		return f;
	}

	private textBox(el: HTMLElement) {
		return el.querySelector<HTMLElement>(':scope > figure > figcaption, :scope > .fact-value') ?? el;
	}

	private moveCursor(target: HTMLElement, user: string) {
		const r = target.getBoundingClientRect();
		const c = this.content.getBoundingClientRect();
		let hue = 0;
		for (const ch of user) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
		this.cursor.style.setProperty('--hue', String(hue));
		this.cursor.style.setProperty('--dur', `${this.ms(520)}ms`);
		this.cursorName.textContent = user;
		this.cursor.style.transform = `translate(${r.left - c.left - 3}px, ${r.top - c.top}px)`;
		this.cursor.style.height = `${Math.max(18, Math.min(r.height, 34))}px`;
		this.cursor.classList.add('on');
	}

	private async camera(target: HTMLElement) {
		const g = this.gen;
		const root = this.root;
		const vh = root.clientHeight;
		const y = target.getBoundingClientRect().top - root.getBoundingClientRect().top;
		if (y > vh * 0.1 && y < vh * 0.62) return true;
		const from = root.scrollTop;
		const to = clamp(from + y - vh * 0.3, 0, root.scrollHeight - vh);
		const dist = Math.abs(to - from);
		const dur = this.ms(clamp(280 + dist * 0.18, 320, 950));
		if (dur < 60 || dist < 4) {
			root.scrollTop = to;
			return true;
		}
		const t0 = performance.now();
		await new Promise<void>((resolve) => {
			const step = (now: number) => {
				if (g !== this.gen) return resolve();
				const s = Math.min(1, (now - t0) / dur);
				const e = s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2;
				root.scrollTop = from + (to - from) * e;
				if (s < 1) requestAnimationFrame(step);
				else resolve();
			};
			requestAnimationFrame(step);
		});
		return g === this.gen;
	}

	// ─── transition ─────────────────────────────────────────────────────────

	/** Animate from the currently shown blocks to `next`. Resolves when done or cancelled. */
	async transition(next: Block[], plan: Plan, user: string): Promise<boolean> {
		const g = this.gen;
		this.settle();
		this.readColors();
		const prev = this.blocks;

		let volume = 0;
		for (const it of plan.items) {
			if (it.kind === 'ins') volume += next[it.to].type === 'img' ? 25 : next[it.to].text.length / 6;
			else if (it.kind === 'del') volume += prev[it.from].type === 'img' ? 25 : prev[it.from].text.length / 6;
			else if (it.kind === 'mod') volume += it.words.filter((w) => w.t !== 'eq').length;
		}
		const detail: Detail =
			this.speed >= 12 || volume > 1500 ? 'coarse' : this.speed >= 4 || volume > 260 ? 'words' : 'full';

		// Each change becomes a deferred step: its DOM is only touched once the
		// camera arrives, so the reader never sees a region change off-cue.
		interface Step {
			anchor: () => HTMLElement | null;
			build: () => Job;
		}
		const live: Live[] = [];
		const itemEls: HTMLElement[] = [];
		const steps: Step[] = [];
		const firstBlock = prev[0]?.el ?? null;
		const connectedBefore = (i: number) => {
			for (let k = i - 1; k >= 0; k--) if (itemEls[k].isConnected) return itemEls[k];
			return null;
		};
		plan.items.forEach((it, i) => {
			if (it.kind === 'keep') {
				live.push(prev[it.from]);
				itemEls.push(prev[it.from].el);
			} else if (it.kind === 'del') {
				const b = prev[it.from];
				itemEls.push(b.el);
				steps.push({
					anchor: () => b.el,
					build: () => (b.type === 'img' ? this.imgDel(b, detail) : this.blockDel(b, detail))
				});
			} else if (it.kind === 'ins') {
				const nb = next[it.to];
				const b: Live = { ...nb, el: h('div', this.blockClass(nb)) };
				live.push(b);
				itemEls.push(b.el);
				steps.push({
					anchor: () => connectedBefore(i) ?? firstBlock,
					build: () => {
						const before = connectedBefore(i);
						if (before) before.after(b.el);
						else this.content.prepend(b.el);
						this.dirty.push(b);
						return nb.type === 'img' ? this.imgIns(b, detail) : this.blockIns(b, detail);
					}
				});
			} else {
				const nb = next[it.to];
				const b: Live = { ...nb, el: prev[it.from].el };
				const oldFile = prev[it.from].file ?? '';
				live.push(b);
				itemEls.push(b.el);
				steps.push({
					anchor: () => b.el,
					build: () => {
						b.el.className = this.blockClass(nb);
						this.dirty.push(b);
						if (nb.type === 'img') return this.imgMod(oldFile, b, it.words, detail);
						return this.blockMod(b, it.words, detail, this.textBox(b.el));
					}
				});
			}
		});
		this.blocks = live;
		if (!steps.length) return true;

		// Group nearby changes into "shots" that the camera visits in turn.
		const vh = this.root.clientHeight;
		const shots: { steps: Step[]; top: number }[] = [];
		for (const s of steps) {
			const top = s.anchor()?.offsetTop ?? 0;
			const last = shots[shots.length - 1];
			if (last && Math.abs(top - last.top) < vh * 0.45) {
				last.steps.push(s);
				last.top = top;
			} else shots.push({ steps: [s], top });
		}
		const maxShots = detail === 'coarse' ? 1 : detail === 'words' ? 3 : 6;
		while (shots.length > maxShots) shots[maxShots - 1].steps.push(...shots.splice(maxShots, 1)[0].steps);

		for (let s = 0; s < shots.length; s++) {
			const shot = shots[s].steps;
			const focus = shot[0].anchor();
			if (focus && !(await this.camera(focus))) return false;
			if (g !== this.gen) return false;

			// Build, then batch layout: read → write → read, then schedule.
			const jobs = shot.map((st) => st.build());
			for (const j of jobs) j.measure?.();
			for (const j of jobs) j.apply?.();
			for (const j of jobs) j.measure2?.();
			this.moveCursor(jobs[0].anchor(), user);

			let end = 0;
			const gap = detail === 'coarse' ? 0 : Math.min(160, 900 / jobs.length);
			jobs.forEach((j, k) => (end = Math.max(end, j.start(120 + k * gap))));
			const isLast = s === shots.length - 1;
			if (!(await this.wait(isLast ? end : end * 0.8))) return false;
		}
		this.cursor.classList.remove('on');
		return g === this.gen;
	}

	// ─── block-level jobs ───────────────────────────────────────────────────

	private blockIns(b: Live, detail: Detail): Job {
		const el = b.el;
		const box = this.renderBlock(el, b);
		const words: HTMLElement[] = [];
		if (detail !== 'coarse' && b.text.length / 6 < 160) {
			box.textContent = '';
			for (const t of tokenize(b.text)) {
				if (t.trim()) {
					const s = h('span', 'w', t);
					box.append(s);
					words.push(s);
				} else box.append(t);
			}
		}
		let height = 0;
		let mt = '0px';
		let mb = '0px';
		return {
			el,
			anchor: () => el,
			measure: () => {
				height = el.getBoundingClientRect().height;
				const cs = getComputedStyle(el);
				mt = cs.marginTop;
				mb = cs.marginBottom;
			},
			apply: () => {
				el.style.overflow = 'hidden';
			},
			start: (T) => {
				const open = detail === 'coarse' ? 320 : 520;
				this.sound('pop', T);
				this.anim(
					el,
					[
						{ height: '0px', marginTop: '0px', marginBottom: '0px' },
						{ height: `${height}px`, marginTop: mt, marginBottom: mb }
					],
					{ duration: open, delay: T, easing: EASE_OUT, done: () => (el.style.overflow = '') }
				);
				this.anim(
					el,
					[
						{ backgroundColor: this.col.insBg, boxShadow: `-6px 0 0 ${this.col.ins}` },
						{ backgroundColor: this.col.insBg, boxShadow: `-6px 0 0 ${this.col.ins}`, offset: 0.55 },
						{ backgroundColor: 'transparent', boxShadow: '-6px 0 0 transparent' }
					],
					{ duration: 2600, delay: T, easing: 'linear' }
				);
				if (!words.length) {
					this.anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: open, delay: T });
					return T + open;
				}
				const step = Math.min(38, 1100 / words.length);
				const fancy = detail === 'full';
				words.forEach((w, k) => {
					if (k % 3 === 0) this.sound('type', T + 160 + k * step);
					this.anim(
						w,
						fancy
							? [
									{ opacity: 0, transform: `translateY(.9em) rotate(${rnd(-12, 12)}deg) scale(.7)`, filter: 'blur(5px)' },
									{ opacity: 1, transform: 'none', filter: 'blur(0px)' }
								]
							: [
									{ opacity: 0, transform: 'translateY(.6em)' },
									{ opacity: 1, transform: 'none' }
								],
						{ duration: 520, delay: T + 160 + k * step, easing: SPRING }
					);
				});
				return T + 160 + words.length * step + 520;
			}
		};
	}

	private blockDel(b: Live, detail: Detail): Job {
		const el = b.el;
		const words: HTMLElement[] = [];
		if (detail !== 'coarse' && b.text.length / 6 < 160) {
			const box = this.textBox(el);
			box.textContent = '';
			for (const t of tokenize(b.text)) {
				if (t.trim()) {
					const s = h('span', 'w', t);
					box.append(s);
					words.push(s);
				} else box.append(t);
			}
		}
		let height = 0;
		let mt = '0px';
		let mb = '0px';
		return {
			el,
			anchor: () => el,
			measure: () => {
				height = el.getBoundingClientRect().height;
				const cs = getComputedStyle(el);
				mt = cs.marginTop;
				mb = cs.marginBottom;
			},
			apply: () => {
				el.style.textDecorationLine = 'line-through';
				el.style.textDecorationThickness = '.09em';
			},
			start: (T) => {
				const strike = detail === 'coarse' ? 160 : 320;
				this.sound('strike', T);
				this.sound('crumble', T + strike + 60);
				this.anim(
					el,
					[
						{ textDecorationColor: 'transparent', color: this.col.text },
						{ textDecorationColor: this.col.del, color: this.col.del }
					],
					{ duration: strike, delay: T, end: 'keep' }
				);
				let fallEnd = T + strike;
				if (words.length) {
					const spread = Math.min(520, words.length * 22);
					for (const w of words) {
						const d = T + strike + 60 + Math.random() * spread;
						this.anim(w, gravity(rnd(-40, 40), rnd(70, 160), rnd(-160, 160), rnd(8, 30)), {
							duration: 760,
							delay: d,
							easing: 'linear',
							end: 'keep'
						});
						fallEnd = Math.max(fallEnd, d + 760);
					}
				} else {
					this.anim(
						el,
						[
							{ transform: 'none', opacity: 1, filter: 'blur(0px)' },
							{ transform: 'translateY(28px) rotate(-1.5deg) scale(.97)', opacity: 0, filter: 'blur(3px)' }
						],
						{ duration: 520, delay: T + strike, end: 'keep' }
					);
					fallEnd = T + strike + 520;
				}
				const collapseAt = T + strike + (words.length ? 380 : 260);
				this.anim(
					el,
					[
						{ height: `${height}px`, marginTop: mt, marginBottom: mb },
						{ height: '0px', marginTop: '0px', marginBottom: '0px' }
					],
					{ duration: 480, delay: collapseAt, easing: IN_OUT, end: 'keep' }
				);
				const endAt = Math.max(fallEnd, collapseAt + 480);
				this.doom(el, endAt);
				return endAt;
			}
		};
	}

	// ─── images ─────────────────────────────────────────────────────────────

	/** New image: the float grows open, the card tumbles in and the photo "develops". */
	private imgIns(b: Live, detail: Detail): Job {
		const el = b.el;
		const cap = this.renderBlock(el, b);
		const fig = el.firstElementChild as HTMLElement;
		const img = fig.querySelector('img');
		let w = 0;
		let hgt = 0;
		let ml = '0px';
		let mb = '0px';
		return {
			el,
			anchor: () => el,
			measure: () => {
				const r = el.getBoundingClientRect();
				w = r.width;
				hgt = r.height;
				const cs = getComputedStyle(el);
				ml = cs.marginLeft;
				mb = cs.marginBottom;
			},
			apply: () => {
				// Keep the card at full size while its slot grows, so the photo doesn't squash.
				fig.style.width = `${w}px`;
			},
			start: (T) => {
				const coarse = detail === 'coarse';
				this.sound('photo', T + 120);
				this.anim(
					el,
					[
						{ width: '0px', height: '0px', marginLeft: '0px', marginBottom: '0px' },
						{ width: `${w}px`, height: `${hgt}px`, marginLeft: ml, marginBottom: mb }
					],
					{ duration: coarse ? 300 : 650, delay: T, easing: EASE_OUT }
				);
				this.anim(
					fig,
					[
						{ opacity: 0, transform: 'translateY(-70px) scale(.25) rotate(-16deg)' },
						{ opacity: 1, transform: 'translateY(10px) scale(1.07) rotate(3deg)', offset: 0.6 },
						{ opacity: 1, transform: 'translateY(-3px) scale(.98) rotate(-1deg)', offset: 0.8 },
						{ opacity: 1, transform: 'none' }
					],
					{ duration: coarse ? 350 : 950, delay: T + 120, easing: 'ease-out' }
				);
				if (img && !coarse)
					this.anim(
						img,
						[
							{ filter: 'blur(16px) saturate(0) brightness(1.8)' },
							{ filter: 'blur(5px) saturate(.3) brightness(1.35)', offset: 0.4 },
							{ filter: 'blur(0px) saturate(1) brightness(1)' }
						],
						{ duration: 1700, delay: T + 280, easing: 'ease-out' }
					);
				this.anim(
					fig,
					[
						{ boxShadow: `0 0 0 3px ${this.col.ins}, 0 12px 40px ${this.col.insBg}` },
						{ boxShadow: `0 0 0 3px ${this.col.ins}, 0 12px 40px ${this.col.insBg}`, offset: 0.5 }
					],
					{ duration: 2400, delay: T + 120, easing: 'linear', fill: 'none' }
				);
				this.anim(cap, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], {
					duration: 500,
					delay: T + (coarse ? 250 : 800)
				});
				return T + (coarse ? 600 : 1800);
			}
		};
	}

	/** Removed image: it shakes, flushes red, then shatters into tiles that tumble away. */
	private imgDel(b: Live, detail: Detail): Job {
		const el = b.el;
		const fig = el.querySelector('figure') as HTMLElement;
		const frame = el.querySelector('.tm-frame') as HTMLElement;
		const img = frame.querySelector('img');
		const cap = this.textBox(el);
		let w = 0;
		let hgt = 0;
		let ml = '0px';
		let mb = '0px';
		let fw = 0;
		let fh = 0;
		return {
			el,
			anchor: () => el,
			measure: () => {
				const r = el.getBoundingClientRect();
				w = r.width;
				hgt = r.height;
				const cs = getComputedStyle(el);
				ml = cs.marginLeft;
				mb = cs.marginBottom;
				fw = frame.offsetWidth;
				fh = frame.offsetHeight;
			},
			start: (T) => {
				const coarse = detail === 'coarse';
				this.anim(
					fig,
					[
						{ transform: 'none' },
						{ transform: 'rotate(-3deg) scale(1.04)', offset: 0.25 },
						{ transform: 'rotate(3deg) scale(1.04)', offset: 0.5 },
						{ transform: 'rotate(-2deg) scale(1.02)', offset: 0.75 },
						{ transform: 'none' }
					],
					{ duration: coarse ? 200 : 440, delay: T, easing: 'ease-in-out', fill: 'none' }
				);
				this.anim(frame, [{ filter: 'none' }, { filter: 'grayscale(1) sepia(1) saturate(5) hue-rotate(-50deg) brightness(.9)' }], {
					duration: 380,
					delay: T,
					end: 'keep'
				});
				this.anim(cap, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: T + 250, end: 'keep' });
				const breakAt = T + (coarse ? 200 : 460);
				this.sound('shatter', breakAt);
				if (img && !coarse && fw > 0 && fh > 0) {
					this.later(breakAt, () => {
						const src = img.currentSrc || img.src;
						const cols = 4;
						const rows = clamp(Math.round((cols * fh) / fw), 2, 6);
						frame.style.overflow = 'visible';
						frame.style.background = 'transparent';
						img.style.visibility = 'hidden';
						fig.style.background = 'transparent';
						fig.style.borderColor = 'transparent';
						fig.style.boxShadow = 'none';
						for (let r = 0; r < rows; r++)
							for (let c = 0; c < cols; c++) {
								const tile = h('i', 'tm-tile');
								const x = (c * fw) / cols;
								const y = (r * fh) / rows;
								Object.assign(tile.style, {
									left: `${x}px`,
									top: `${y}px`,
									width: `${fw / cols + 0.5}px`,
									height: `${fh / rows + 0.5}px`,
									backgroundImage: `url("${src}")`,
									backgroundSize: `${fw}px ${fh}px`,
									backgroundPosition: `${-x}px ${-y}px`
								});
								frame.append(tile);
								const spread = (c + 0.5) / cols - 0.5;
								this.anim(tile, gravity(spread * rnd(90, 200), rnd(180, 340), rnd(-260, 260), rnd(20, 60)), {
									duration: rnd(850, 1150),
									delay: rnd(0, 140) + (rows - r) * 30,
									easing: 'linear',
									end: 'keep'
								});
							}
					});
				} else {
					this.anim(fig, gravity(rnd(-40, 40), 220, rnd(-35, 35), 20), {
						duration: 800,
						delay: breakAt,
						easing: 'linear',
						end: 'keep'
					});
				}
				const collapseAt = breakAt + 260;
				this.anim(
					el,
					[
						{ width: `${w}px`, height: `${hgt}px`, marginLeft: ml, marginBottom: mb },
						{ width: '0px', height: '0px', marginLeft: '0px', marginBottom: '0px' }
					],
					{ duration: 540, delay: collapseAt, easing: IN_OUT, end: 'keep' }
				);
				const endAt = breakAt + 1350;
				this.doom(el, endAt);
				return endAt;
			}
		};
	}

	/** Same slot, different file: the card flips over to reveal the new picture. */
	private imgMod(oldFile: string, b: Live, ops: WordOp[], detail: Detail): Job {
		const el = b.el;
		const job = this.blockMod(b, ops, detail, this.textBox(el));
		if (oldFile === b.file) return job;
		const fig = el.querySelector('figure') as HTMLElement;
		const oldFrame = fig.querySelector('.tm-frame') as HTMLElement;
		return {
			...job,
			anchor: () => el,
			start: (T) => {
				const turn = detail === 'coarse' ? 420 : 1000;
				this.sound('flip', T);
				const p = 'perspective(900px)';
				this.anim(
					fig,
					[
						{ transform: `${p} rotateY(0deg)` },
						{ transform: `${p} rotateY(90deg) scale(.9)`, offset: 0.42 },
						{ transform: `${p} rotateY(-90deg) scale(.9)`, offset: 0.4201 },
						{ transform: `${p} rotateY(14deg) scale(1.04)`, offset: 0.78 },
						{ transform: `${p} rotateY(-4deg)`, offset: 0.9 },
						{ transform: `${p} rotateY(0deg)` }
					],
					{ duration: turn, delay: T, easing: 'ease-in-out', fill: 'none' }
				);
				// Swap while the card is edge-on, so the change is invisible.
				this.later(T + turn * 0.42, () => {
					if (oldFrame.isConnected) oldFrame.replaceWith(this.frame(b.file!));
				});
				this.anim(
					fig,
					[
						{ boxShadow: `0 0 0 3px ${this.col.spark}, 0 12px 40px ${this.col.fix}` },
						{ boxShadow: `0 0 0 3px ${this.col.spark}, 0 12px 40px ${this.col.fix}`, offset: 0.4 }
					],
					{ duration: 2000, delay: T + turn * 0.42, easing: 'linear', fill: 'none' }
				);
				return Math.max(job.start(T + turn * 0.5), T + turn + 300);
			}
		};
	}

	// ─── word-level edits inside a paragraph ────────────────────────────────

	private blockMod(b: Live, ops: WordOp[], detail: Detail, box: HTMLElement = b.el): Job {
		const el = b.el;
		box.textContent = '';
		interface Tok {
			op: WordOp;
			span: HTMLElement;
			pos: number;
			chars: HTMLElement[];
			w0: number;
			fix?: FixState;
		}
		const toks: Tok[] = [];
		ops.forEach((op, pos) => {
			if (op.t === 'eq') {
				box.append(richText(op.text));
				return;
			}
			const text = op.t === 'fix' ? op.from : op.text;
			const span = h('span', `tk tk-${op.t}`);
			const blank = !text.trim();
			if (blank) span.classList.add('tk-space');
			const chars =
				op.t === 'fix' || (detail === 'full' && !blank && text.length <= 40 && !isMath(text))
					? splitLetters(span, text)
					: (setRichText(span, text), []);
			box.append(span);
			toks.push({ op, span, pos, chars, w0: 0 });
		});

		// Group into units: a run of deletions + the insertions right after it, or a lone fix.
		interface Unit {
			dels: Tok[];
			ins: Tok[];
			fix?: Tok;
		}
		const units: Unit[] = [];
		for (let i = 0; i < toks.length; ) {
			const t = toks[i];
			if (t.op.t === 'fix') {
				units.push({ dels: [], ins: [], fix: t });
				i++;
				continue;
			}
			const u: Unit = { dels: [], ins: [] };
			let pos = t.pos - 1;
			while (i < toks.length && toks[i].op.t === 'del' && toks[i].pos === pos + 1) {
				u.dels.push(toks[i]);
				pos = toks[i++].pos;
			}
			while (i < toks.length && toks[i].op.t === 'ins' && toks[i].pos === pos + 1) {
				u.ins.push(toks[i]);
				pos = toks[i++].pos;
			}
			units.push(u);
		}

		return {
			el,
			anchor: () => toks[0]?.span ?? el,
			measure: () => {
				for (const t of toks) {
					t.w0 = t.span.getBoundingClientRect().width;
					if (t.op.t === 'fix') t.fix = this.fixMeasure(t.chars, t.w0);
				}
			},
			apply: () => {
				for (const t of toks) if (t.fix && t.op.t === 'fix') this.fixApply(t.span, t.fix, t.op.to);
			},
			measure2: () => {
				for (const t of toks) if (t.fix) this.fixMeasure2(t.span, t.fix);
			},
			start: (T) => {
				const step = Math.min(150, 1500 / Math.max(1, units.length));
				let end = T;
				units.forEach((u, k) => {
					const t0 = T + k * step;
					if (u.fix) {
						end = Math.max(end, this.fixStart(u.fix.span, u.fix.fix!, t0, detail));
						return;
					}
					let tIns = t0;
					if (u.dels.length) {
						const dEnd = this.delTokens(u.dels, t0, detail);
						end = Math.max(end, dEnd);
						tIns = t0 + (detail === 'coarse' ? 120 : 360);
					}
					if (u.ins.length) end = Math.max(end, this.insTokens(u.ins, tIns, detail));
				});
				return end;
			}
		};
	}

	private delTokens(toks: { span: HTMLElement; chars: HTMLElement[]; w0: number }[], T: number, detail: Detail) {
		const step = Math.min(28, 420 / toks.length);
		let end = T;
		toks.forEach((t, k) => {
			const at = T + k * step;
			const { span, chars, w0 } = t;
			if (k === 0) {
				this.sound('strike', at);
				this.sound('crumble', at + 320);
			}
			if (detail === 'coarse') {
				this.anim(span, [{ color: this.col.del, opacity: 1 }, { color: this.col.del, opacity: 0 }], {
					duration: 220,
					delay: at,
					end: 'keep'
				});
				this.anim(span, [{ width: `${w0}px` }, { width: '0px' }], { duration: 260, delay: at + 60, easing: IN_OUT, end: 'remove' });
				end = Math.max(end, at + 320);
				return;
			}
			const line = h('i', 'strike');
			span.append(line);
			this.anim(span, [{ color: this.col.text }, { color: this.col.del }], { duration: 200, delay: at, end: 'keep' });
			this.anim(line, [{ transform: 'scaleX(0)', opacity: 1 }, { transform: 'scaleX(1)', opacity: 1 }], {
				duration: 260,
				delay: at,
				easing: IN_OUT,
				end: 'keep'
			});
			const crumble = at + 320;
			this.anim(line, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, delay: crumble, fill: 'forwards', end: 'keep' });
			if (chars.length) {
				chars.forEach((c, i) =>
					this.anim(c, gravity(rnd(-26, 26), rnd(40, 95), rnd(-240, 240), rnd(6, 20)), {
						duration: 640,
						delay: crumble + i * 24,
						easing: 'linear',
						end: 'keep'
					})
				);
			} else if (span.textContent!.trim()) {
				this.anim(span, gravity(rnd(-20, 20), rnd(40, 80), rnd(-60, 60), 12), {
					duration: 600,
					delay: crumble,
					easing: 'linear',
					end: 'keep'
				});
			}
			const collapse = crumble + 160;
			this.anim(span, [{ width: `${w0}px` }, { width: '0px' }], {
				duration: 420,
				delay: collapse,
				easing: IN_OUT,
				end: 'keep'
			});
			const done = Math.max(collapse + 420, crumble + chars.length * 24 + 640);
			this.doom(span, done);
			end = Math.max(end, done);
		});
		return end;
	}

	private insTokens(toks: { span: HTMLElement; chars: HTMLElement[]; w0: number }[], T: number, detail: Detail) {
		const step = Math.min(detail === 'full' ? 70 : 40, 1100 / toks.length);
		let end = T;
		toks.forEach((t, k) => {
			const at = T + k * step;
			const { span, chars, w0 } = t;
			const open = detail === 'coarse' ? 240 : 380;
			if (k === 0) this.sound('pop', at);
			this.anim(span, [{ width: '0px' }, { width: `${w0}px` }], { duration: open, delay: at, easing: PUSH });
			if (!span.classList.contains('tk-space')) {
				this.anim(
					span,
					[
						{ color: this.col.ins, backgroundColor: this.col.insBg },
						{ color: this.col.ins, backgroundColor: this.col.insBg, offset: 0.5 },
						{ color: this.col.text, backgroundColor: 'transparent' }
					],
					{ duration: 2400, delay: at, easing: 'linear' }
				);
			}
			if (chars.length) {
				const cs = Math.min(26, 260 / chars.length);
				chars.forEach((_, i) => this.sound('type', at + open * 0.35 + i * cs));
				chars.forEach((c, i) =>
					this.anim(
						c,
						[
							{ opacity: 0, transform: `translateY(-.95em) scale(.3) rotate(${rnd(-30, 30)}deg)` },
							{ opacity: 1, transform: 'translateY(.08em) scaleX(1.2) scaleY(.8)', offset: 0.62 },
							{ opacity: 1, transform: 'translateY(-.05em) scale(1.06)', offset: 0.82 },
							{ opacity: 1, transform: 'none' }
						],
						{ duration: 420, delay: at + open * 0.35 + i * cs, easing: 'ease-out' }
					)
				);
				end = Math.max(end, at + open * 0.35 + chars.length * cs + 420);
			} else {
				this.anim(
					span,
					[
						{ opacity: 0, transform: 'translateY(-.5em) scale(.6)' },
						{ opacity: 1, transform: 'none' }
					],
					{ duration: open + 80, delay: at + open * 0.3, easing: SPRING }
				);
				end = Math.max(end, at + open + 400);
			}
		});
		return end;
	}

	// ─── the whacky typo fix ────────────────────────────────────────────────

	private fixMeasure(chars: HTMLElement[], w0: number): FixState {
		return {
			old: chars,
			oldPos: chars.map((c) => ({ x: c.offsetLeft, y: c.offsetTop })),
			w0,
			w1: w0,
			next: [],
			newPos: [],
			match: [],
			hop: [],
			gone: [],
			flips: []
		};
	}

	private fixApply(span: HTMLElement, f: FixState, to: string) {
		const target = [...to];
		const from = f.old.map((c) => c.textContent!);
		const { match, hop, used } = matchLetters(from, target);
		f.match = match;
		f.hop = hop;
		f.next = target.map((ch, j) => {
			if (match[j] < 0) return h('span', 'ch', ch);
			const e = f.old[match[j]];
			if (e.textContent !== ch) {
				f.flips.push({ el: e, from: e.textContent!, to: ch });
				e.textContent = ch;
			}
			return e;
		});
		f.gone = f.old.filter((_, i) => !used[i]);
		span.textContent = '';
		span.append(...f.next);
		f.gone.forEach((e) => {
			const p = f.oldPos[f.old.indexOf(e)];
			e.classList.add('ch-gone');
			e.style.left = `${p.x}px`;
			e.style.top = `${p.y}px`;
			span.append(e);
		});
	}

	private fixMeasure2(span: HTMLElement, f: FixState) {
		f.newPos = f.next.map((c) => ({ x: c.offsetLeft, y: c.offsetTop }));
		f.w1 = span.getBoundingClientRect().width;
		// Show the old casing until the flip happens.
		for (const fl of f.flips) fl.el.textContent = fl.from;
	}

	private fixStart(span: HTMLElement, f: FixState, T: number, detail: Detail) {
		const fontPx = parseFloat(getComputedStyle(span).fontSize) || 16;
		const quick = detail === 'coarse';
		const notice = quick ? 0 : 420;

		// 1. "Hm, what's this?" — highlight sweep + wobble.
		this.anim(
			span,
			[
				{ backgroundColor: 'transparent' },
				{ backgroundColor: this.col.fix, offset: 0.12 },
				{ backgroundColor: this.col.fix, offset: 0.75 },
				{ backgroundColor: 'transparent' }
			],
			{ duration: quick ? 700 : 1900, delay: T, easing: 'linear', fill: 'none' }
		);
		if (!quick)
			this.anim(
				span,
				[
					{ transform: 'none' },
					{ transform: 'rotate(-8deg) scale(1.14)', offset: 0.2 },
					{ transform: 'rotate(7deg) scale(1.18)', offset: 0.45 },
					{ transform: 'rotate(-5deg) scale(1.14)', offset: 0.7 },
					{ transform: 'rotate(2deg) scale(1.06)', offset: 0.88 },
					{ transform: 'none' }
				],
				{ duration: notice, delay: T, easing: 'ease-in-out', fill: 'none' }
			);

		const act = T + notice;
		if (!quick) this.sound('wobble', T);
		// 2. The word reshapes itself.
		this.anim(span, [{ width: `${f.w0}px` }, { width: `${f.w1}px` }], { duration: 420, delay: act + 80, easing: SPRING });

		// 3. Wrong letters get flung off, spinning.
		f.gone.forEach((e, k) => {
			const dir = Math.random() < 0.5 ? -1 : 1;
			this.anim(
				e,
				[
					{ transform: 'none', opacity: 1, color: this.col.del },
					{ transform: `translate(${dir * 4}px, -${fontPx * 0.9}px) scale(1.6) rotate(${dir * 25}deg)`, opacity: 1, color: this.col.del, offset: 0.22 },
					{ transform: `translate(${dir * rnd(50, 90)}px, ${-fontPx * 1.6}px) scale(1) rotate(${dir * 400}deg)`, opacity: 0.9, color: this.col.del, offset: 0.55 },
					{ transform: `translate(${dir * rnd(90, 140)}px, ${fontPx * 2.5}px) scale(.5) rotate(${dir * 720}deg)`, opacity: 0, color: this.col.del }
				],
				{ duration: quick ? 450 : 900, delay: act + k * 70, easing: 'cubic-bezier(.3,.5,.5,1)', end: 'remove' }
			);
		});

		// 4. Surviving letters slide or leap-frog into their new slots.
		f.next.forEach((e, j) => {
			if (f.match[j] < 0) return;
			const o = f.oldPos[f.match[j]];
			const n = f.newPos[j];
			const dx = o.x - n.x;
			const dy = o.y - n.y;
			const flip = f.flips.find((fl) => fl.el === e);
			if (flip) this.later(act + 200, () => (e.textContent = flip.to));
			if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && !flip) return;
			if (f.hop[j] || flip) {
				const up = dx > 0 ? -1 : 1; // letters moving left go over, right go under
				this.anim(
					e,
					[
						{ transform: `translate(${dx}px, ${dy}px)` },
						{
							transform: `translate(${dx / 2}px, ${dy / 2 + up * fontPx * 0.85}px) rotate(${-up * 30}deg) scale(1.3) rotateY(${flip ? 180 : 0}deg)`,
							offset: 0.5
						},
						{ transform: 'none' }
					],
					{ duration: quick ? 360 : 640, delay: act + 60, easing: IN_OUT }
				);
			} else {
				this.anim(e, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
					duration: 460,
					delay: act + 120,
					easing: SPRING
				});
			}
		});

		// 5. Correct letters drop in from above with a squash & stretch landing.
		let k = 0;
		f.next.forEach((e, j) => {
			if (f.match[j] >= 0) return;
			this.sound('type', act + 260 + k * 90 + (quick ? 160 : 550));
			this.anim(
				e,
				[
					{ opacity: 0, transform: `translateY(${-fontPx * 1.6}px) scale(.3) rotate(-50deg)`, color: this.col.ins },
					{ opacity: 1, transform: 'translateY(0) scaleX(1.45) scaleY(.6)', color: this.col.ins, offset: 0.55 },
					{ opacity: 1, transform: `translateY(${-fontPx * 0.25}px) scaleX(.85) scaleY(1.2)`, color: this.col.ins, offset: 0.75 },
					{ opacity: 1, transform: 'none', color: this.col.ins, offset: 0.9 },
					{ opacity: 1, transform: 'none', color: this.col.text }
				],
				{ duration: quick ? 400 : 1000, delay: act + 260 + k++ * 90, easing: 'ease-out' }
			);
		});

		// 6. Ta-da: a sparkle burst and a little boing.
		const tada = act + (quick ? 300 : 700) + k * 90;
		if (!quick) this.sound('sparkle', tada);
		if (!quick) {
			this.anim(
				span,
				[
					{ transform: 'none' },
					{ transform: 'scale(1.22)', offset: 0.3 },
					{ transform: 'scale(.94)', offset: 0.65 },
					{ transform: 'none' }
				],
				{ duration: 420, delay: tada, easing: 'ease-out', fill: 'none' }
			);
			const n = 9;
			for (let i = 0; i < n; i++) {
				const s = h('i', 'spark', i % 3 ? '✦' : '✧');
				s.style.color = i % 2 ? this.col.spark : this.col.ins;
				span.append(s);
				const ang = (i / n) * Math.PI * 2 + rnd(-0.3, 0.3);
				const dist = rnd(fontPx * 1.3, fontPx * 2.4);
				this.anim(
					s,
					[
						{ transform: 'translate(-50%,-50%) scale(0) rotate(0deg)', opacity: 1 },
						{
							transform: `translate(calc(-50% + ${Math.cos(ang) * dist * 0.7}px), calc(-50% + ${Math.sin(ang) * dist * 0.7}px)) scale(1.3) rotate(90deg)`,
							opacity: 1,
							offset: 0.45
						},
						{
							transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px)) scale(0) rotate(200deg)`,
							opacity: 0
						}
					],
					{ duration: 700, delay: tada + 40, easing: EASE_OUT, end: 'remove' }
				);
			}
		}
		return tada + (quick ? 200 : 760);
	}
}

interface FixState {
	old: HTMLElement[];
	oldPos: { x: number; y: number }[];
	w0: number;
	w1: number;
	next: HTMLElement[];
	newPos: { x: number; y: number }[];
	match: number[];
	hop: boolean[];
	gone: HTMLElement[];
	flips: { el: HTMLElement; from: string; to: string }[];
}
