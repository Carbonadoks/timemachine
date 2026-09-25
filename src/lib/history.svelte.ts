import { fetchAllRevisions, fetchImageInfo, fetchRevisionContents, type ImgInfo, type RevisionMeta } from './wiki';
import { wikitextToBlocks, type Block } from './wikitext';
import { hasMath, loadMath } from './math';
import { planBlocks, type Plan } from './diff';
import type { Stage } from './animator';

export type StepMode = 'edit' | 'day' | 'month' | 'year';

const TEXT_CACHE = 400;
const BLOCK_CACHE = 200;
/** Background prefetch batch: small enough that the first batch lands quickly. */
const PREFETCH_BATCH = 20;

function bounded<K, V>(map: Map<K, V>, key: K, value: V, cap: number) {
	map.delete(key);
	map.set(key, value);
	while (map.size > cap) map.delete(map.keys().next().value as K);
}

const period = (ts: string, mode: StepMode) =>
	mode === 'year' ? ts.slice(0, 4) : mode === 'month' ? ts.slice(0, 7) : mode === 'day' ? ts.slice(0, 10) : ts;

export class History {
	revisions = $state.raw<RevisionMeta[]>([]);
	loadingMeta = $state(true);
	error = $state<string | null>(null);
	/** Index of the revision on screen; -1 is the empty page before creation. */
	index = $state(-1);
	playing = $state(false);
	speed = $state(1);
	step = $state<StepMode>('edit');
	fetching = $state(false);
	/** Revision being loaded for a jump (the UI shows a spinner on it). */
	pending = $state<number | null>(null);
	plan = $state.raw<Plan | null>(null);

	private stage: Stage | null = null;
	private texts = new Map<number, string | null>();
	private blocks = new Map<number, Block[]>();
	private token = 0;
	private prefetching = false;
	/** revid → the request currently downloading it, so nothing is fetched twice. */
	private inflight = new Map<number, Promise<void>>();
	private abort = new AbortController();
	private images = new Map<string, ImgInfo | null>();
	/** Timestamp to open at, waiting for the revision list to reach it. */
	private startAt: string | null = null;
	private decoded = new Map<string, Promise<void>>();

	constructor(
		readonly title: string,
		readonly lang: string
	) {}

	get current(): RevisionMeta | null {
		return this.revisions[this.index] ?? null;
	}

	async loadMeta() {
		try {
			await fetchAllRevisions(
				this.title,
				this.lang,
				(all) => {
					this.revisions = all.slice();
					this.tryStartAt();
				},
				this.abort.signal
			);
		} catch (e) {
			if (!this.abort.signal.aborted) this.error = (e as Error).message;
		} finally {
			this.loadingMeta = false;
			this.tryStartAt();
		}
	}

	/** Show the page as it stood at `ts` (ISO timestamp), once enough of the revision list has streamed in. */
	seekTime(ts: string) {
		this.startAt = ts;
		this.tryStartAt();
	}

	private tryStartAt() {
		const ts = this.startAt;
		if (!ts) return;
		const later = this.revisions.findIndex((r) => r.timestamp > ts);
		if (later < 0 && this.loadingMeta) return; // the list hasn't reached that date yet
		this.startAt = null;
		this.seek((later < 0 ? this.revisions.length : later) - 1);
	}

	destroy() {
		this.abort.abort();
		this.token++;
		this.playing = false;
		this.stage?.cancel();
	}

	async attach(stage: Stage) {
		this.stage = stage;
		stage.speed = this.speed;
		stage.images = this.images;
		await this.seek(this.pending ?? this.index); // a jump requested before the stage existed wins
	}

	/** The stage is going away (view switched): stop and forget it. */
	detach() {
		this.token++;
		this.playing = false;
		this.stage?.cancel();
		this.stage = null;
	}

	setSpeed(s: number) {
		this.speed = s;
		if (this.stage) this.stage.speed = s;
	}

	nextIndex(i: number) {
		const n = this.revisions.length;
		if (this.step === 'edit' || i + 1 >= n) return i + 1;
		const p = period(this.revisions[i + 1].timestamp, this.step);
		let j = i + 1;
		while (j + 1 < n && period(this.revisions[j + 1].timestamp, this.step) === p) j++;
		return j;
	}

	private upcoming(i: number, k: number) {
		const out: number[] = [];
		for (let j = this.nextIndex(i); out.length < k && j < this.revisions.length; j = this.nextIndex(j)) out.push(j);
		return out;
	}

	private has(i: number) {
		return i < 0 || this.texts.has(this.revisions[i].revid);
	}

	/** Make sure the text of these revisions is cached, reusing requests already in flight. */
	private async ensure(indices: number[], batch = 50) {
		const ids = [
			...new Set(indices.filter((i) => i >= 0 && i < this.revisions.length).map((i) => this.revisions[i].revid))
		].filter((id) => !this.texts.has(id));
		const waits: Promise<void>[] = [];
		const fresh: number[] = [];
		for (const id of ids) {
			const p = this.inflight.get(id);
			if (p) waits.push(p);
			else fresh.push(id);
		}
		for (let k = 0; k < fresh.length; k += batch) {
			const chunk = fresh.slice(k, k + batch);
			const p = fetchRevisionContents(chunk, this.lang, this.abort.signal)
				.then((got) => {
					for (const [id, text] of got) bounded(this.texts, id, text, TEXT_CACHE);
				})
				.finally(() => {
					for (const id of chunk) if (this.inflight.get(id) === p) this.inflight.delete(id);
				});
			for (const id of chunk) this.inflight.set(id, p);
			waits.push(p);
		}
		await Promise.all(waits);
		this.error = null; // Wikipedia is answering again: drop any earlier warning
	}

	/** Keep a window of upcoming revisions downloading in the background, in small batches. */
	private prefetch(from: number) {
		if (this.prefetching) return;
		const ahead = this.upcoming(from, 60).filter((i) => !this.has(i));
		if (!ahead.length) return;
		this.prefetching = true;
		(async () => {
			try {
				for (let k = 0; k < ahead.length; k += PREFETCH_BATCH)
					await this.ensure(ahead.slice(k, k + PREFETCH_BATCH), PREFETCH_BATCH);
			} catch {
				/* best effort */
			} finally {
				this.prefetching = false;
			}
		})();
	}

	/** Called on hover: quietly load an edit and its parent so a click is instant. */
	warm(i: number) {
		if (i < 0 || i >= this.revisions.length || (this.has(i) && this.has(i - 1))) return;
		this.ensure([i - 1, i]).catch(() => {});
	}

	/** Fetch just what's needed to show revision `i` (plus its parent if asked), right now. */
	private async load(indices: number[]) {
		const need = indices.filter((i) => !this.has(i));
		if (!need.length) return true;
		this.fetching = true;
		try {
			await this.ensure(need, 10);
			// Hidden (revision-deleted) text falls back to earlier versions; make sure a few are here.
			const last = Math.max(...indices);
			if (last >= 0 && this.texts.get(this.revisions[last].revid) === null)
				await this.ensure(Array.from({ length: 10 }, (_, k) => last - 1 - k), 10);
			return true;
		} catch (e) {
			if (!this.abort.signal.aborted) this.error = (e as Error).message;
			return false;
		} finally {
			this.fetching = false;
		}
	}

	private blocksAt(i: number): Block[] {
		for (let k = i; k >= 0; k--) {
			const id = this.revisions[k].revid;
			const hit = this.blocks.get(id);
			if (hit) return hit;
			const text = this.texts.get(id);
			if (text == null) continue; // hidden or unloaded → fall back to the previous version
			const b = wikitextToBlocks(text);
			bounded(this.blocks, id, b, BLOCK_CACHE);
			return b;
		}
		return [];
	}

	/** Load KaTeX if needed, look up thumbnails for any new files and wait (briefly) for them to decode. */
	private async prepareImages(blocks: Block[], waitDecode = true) {
		if (blocks.some((b) => hasMath(b.text))) await loadMath();
		const files = [...new Set(blocks.filter((b) => b.type === 'img').map((b) => b.file!))];
		const unknown = files.filter((f) => !this.images.has(f));
		if (unknown.length) {
			try {
				for (const [f, info] of await fetchImageInfo(unknown, this.lang, this.abort.signal)) this.images.set(f, info);
			} catch {
				/* leave unresolved; the stage shows a placeholder */
			}
		}
		if (!waitDecode) return;
		const loads = files.map((f) => {
			const url = this.images.get(f)?.url;
			if (!url) return Promise.resolve();
			let p = this.decoded.get(url);
			if (!p) {
				const img = new Image();
				img.src = url;
				p = img.decode().catch(() => {});
				this.decoded.set(url, p);
			}
			return p;
		});
		await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 1500))]);
	}

	/** Jump to revision `i` and play on from there. */
	playFrom(i: number) {
		this.playing = true;
		return this.seek(i);
	}

	/** Jump straight to revision `i` without animating. Keeps playing if we were. */
	async seek(i: number, alsoLoad: number[] = []) {
		const token = ++this.token;
		this.stage?.cancel();
		i = Math.max(-1, Math.min(i, this.revisions.length - 1));
		this.pending = i;
		await this.load([i, ...alsoLoad]);
		if (token !== this.token) return;
		const blocks = this.blocksAt(i);
		await this.prepareImages(blocks, false);
		if (token !== this.token) return;
		// Only now does the UI move, so timeline, card and page always agree.
		this.index = i;
		this.plan = null;
		this.pending = null;
		this.stage?.renderStatic(blocks);
		this.prefetch(i);
		if (this.playing) this.run();
	}

	play() {
		if (this.playing) return;
		this.playing = true;
		if (!this.stage) return; // attach() picks it up
		if (this.index >= this.revisions.length - 1 && !this.loadingMeta) {
			// Finished: rewind to the empty page and replay the whole story.
			this.seek(-1);
			return;
		}
		this.run();
	}

	pause() {
		if (!this.playing) return;
		this.playing = false;
		this.token++;
		this.stage?.cancel();
		this.stage?.renderStatic(this.blocksAt(this.index));
	}

	toggle() {
		if (this.playing) this.pause();
		else this.play();
	}

	stepForward() {
		if (this.playing) this.pause();
		this.run(true);
	}

	/** Show the version just before edit `i`, then animate exactly that edit. */
	async playEdit(i: number) {
		if (this.playing) this.pause();
		const token = ++this.token;
		await this.seek(i - 1, [i]); // one small request for the edit and its parent
		if (token + 1 !== this.token) return; // seek() bumps the token once; anything more means the user moved on
		this.run(true, i);
	}

	stepBack() {
		if (this.playing) this.pause();
		this.seek(this.index - 1);
	}

	private sleep(base: number) {
		return new Promise((r) => setTimeout(r, base / this.speed));
	}

	private async run(once = false, target?: number) {
		if (!this.stage) return;
		const token = ++this.token;
		while ((this.playing || once) && token === this.token) {
			const i = this.index;
			const j = target ?? this.nextIndex(i);
			if (j >= this.revisions.length) {
				if (this.loadingMeta && !once) {
					await this.sleep(400);
					continue;
				}
				this.playing = false;
				break;
			}
			this.prefetch(j);
			if (!this.has(j)) {
				if (!(await this.load([j]))) {
					this.playing = false;
					break;
				}
				if (token !== this.token) break;
			}

			const from = this.blocksAt(i);
			const to = this.blocksAt(j);
			const plan = planBlocks(from, to);
			if (plan.imagesAdded || plan.imagesSwapped) {
				await this.prepareImages(to);
				if (token !== this.token) break;
			}
			this.index = j;
			this.plan = plan;
			if (plan.changed && this.stage) {
				const ok = await this.stage.transition(to, plan, this.revisions[j].user);
				if (!ok || token !== this.token) break;
				await this.sleep(once ? 0 : 520);
			} else {
				// Invisible edit (templates, refs, formatting): nothing to animate.
				await this.sleep(once ? 0 : 160);
			}
			if (once) break;
		}
	}
}
