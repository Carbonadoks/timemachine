<script lang="ts">
	import type { RevisionMeta } from '$lib/wiki';
	import { formatDate, formatDelta, cleanComment } from '$lib/format';

	let {
		revisions,
		index,
		onseek,
		onhover
	}: { revisions: RevisionMeta[]; index: number; onseek: (i: number) => void; onhover?: (i: number) => void } = $props();

	// Preload what the pointer rests on, so the click lands on cached text.
	let hoverTimer: ReturnType<typeof setTimeout>;
	$effect(() => {
		const i = hover;
		clearTimeout(hoverTimer);
		if (i >= 0 && onhover) hoverTimer = setTimeout(() => onhover(i), 150);
	});

	let wrap: HTMLDivElement;
	let canvas: HTMLCanvasElement;
	let width = $state(0);
	let hover = $state(-1);
	let hoverX = $state(0);
	let drag = $state(-1);
	let colors = { ins: '#15803d', del: '#dc2626', line: '#ddd', muted: '#888', accent: '#36c', text: '#222' };

	const H = 76;
	const MID = 40;

	function readColors() {
		const cs = getComputedStyle(wrap);
		const v = (n: string) => cs.getPropertyValue(n).trim();
		colors = { ins: v('--tm-ins'), del: v('--tm-del'), line: v('--line'), muted: v('--muted'), accent: v('--accent'), text: v('--text') };
	}

	// Aggregate revisions into at most one bucket per pixel.
	const buckets = $derived.by(() => {
		const n = revisions.length;
		const B = Math.max(1, Math.min(n, Math.floor(width)));
		const pos = new Float32Array(B);
		const neg = new Float32Array(B);
		for (let i = 0; i < n; i++) {
			const b = Math.min(B - 1, Math.floor((i / n) * B));
			const d = revisions[i].delta;
			if (d > 0) pos[b] = Math.max(pos[b], d);
			else neg[b] = Math.max(neg[b], -d);
		}
		let max = 1;
		for (let b = 0; b < B; b++) max = Math.max(max, pos[b], neg[b]);
		return { B, pos, neg, max };
	});

	const years = $derived.by(() => {
		const out: { i: number; label: string }[] = [];
		let last = '';
		revisions.forEach((r, i) => {
			const y = r.timestamp.slice(0, 4);
			if (y !== last) out.push({ i, label: y });
			last = y;
		});
		return out;
	});

	const xOf = (i: number) => ((i + 0.5) / Math.max(1, revisions.length)) * width;
	const idxAt = (x: number) =>
		Math.max(0, Math.min(revisions.length - 1, Math.floor((x / Math.max(1, width)) * revisions.length)));

	$effect(() => {
		readColors();
		const mq = matchMedia('(prefers-color-scheme: dark)');
		const on = () => {
			readColors();
			draw();
		};
		mq.addEventListener('change', on);
		const ro = new ResizeObserver(() => (width = wrap.clientWidth));
		ro.observe(wrap);
		return () => {
			mq.removeEventListener('change', on);
			ro.disconnect();
		};
	});

	function draw() {
		if (!canvas || !width) return;
		const dpr = devicePixelRatio || 1;
		canvas.width = Math.round(width * dpr);
		canvas.height = H * dpr;
		const ctx = canvas.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, H);

		const { B, pos, neg, max } = buckets;
		const scale = (v: number) => (v <= 0 ? 0 : 2 + (Math.log1p(v) / Math.log1p(max)) * (MID - 8));
		const bw = width / B;
		const gap = bw > 4 ? 1 : 0;
		const playX = index < 0 ? -1 : xOf(index);
		for (let b = 0; b < B; b++) {
			const x = b * bw;
			ctx.globalAlpha = x + bw / 2 <= playX + 0.5 ? 1 : 0.28;
			const p = scale(pos[b]);
			const q = scale(neg[b]);
			if (p) {
				ctx.fillStyle = colors.ins;
				ctx.fillRect(x, MID - p, Math.max(1, bw - gap), p);
			}
			if (q) {
				ctx.fillStyle = colors.del;
				ctx.fillRect(x, MID + 1, Math.max(1, bw - gap), q * 0.75);
			}
		}
		ctx.globalAlpha = 1;
		ctx.fillStyle = colors.line;
		ctx.fillRect(0, MID, width, 1);

		// Year ticks
		ctx.font = '600 10px Inter, system-ui, sans-serif';
		ctx.textBaseline = 'alphabetic';
		let lastLabelX = -100;
		for (const y of years) {
			const x = Math.round((y.i / revisions.length) * width) + 0.5;
			ctx.fillStyle = colors.line;
			ctx.fillRect(x, H - 14, 1, 5);
			if (x - lastLabelX > 34 && x + 30 < width) {
				ctx.fillStyle = colors.muted;
				ctx.fillText(y.label, x + 3, H - 3);
				lastLabelX = x;
			}
		}

		const ghost = drag >= 0 ? drag : hover;
		if (ghost >= 0) {
			ctx.fillStyle = colors.muted;
			ctx.globalAlpha = 0.6;
			ctx.fillRect(Math.round(xOf(ghost)), 4, 1, H - 20);
			ctx.globalAlpha = 1;
		}
	}

	$effect(() => {
		void [buckets, years, index, hover, drag, width];
		draw();
	});

	function localX(e: PointerEvent) {
		return e.clientX - canvas.getBoundingClientRect().left;
	}

	function down(e: PointerEvent) {
		if (!revisions.length) return;
		canvas.setPointerCapture(e.pointerId);
		drag = idxAt(localX(e));
		hoverX = localX(e);
	}
	function move(e: PointerEvent) {
		if (!revisions.length) return;
		const x = localX(e);
		hoverX = x;
		if (drag >= 0) drag = idxAt(x);
		else hover = idxAt(x);
	}
	function up() {
		if (drag >= 0) onseek(drag);
		drag = -1;
	}

	const tip = $derived(revisions[drag >= 0 ? drag : hover]);
	const tipIdx = $derived(drag >= 0 ? drag : hover);
	const playLeft = $derived(index < 0 ? 0 : xOf(index));
</script>

<div class="timeline" bind:this={wrap}>
	<canvas
		bind:this={canvas}
		style:height="{H}px"
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointerleave={() => (hover = -1)}
		aria-label="Edit history timeline"
	></canvas>
	{#if revisions.length}
		<div class="playhead" style:transform="translateX({playLeft}px)" class:start={index < 0}>
			<span class="knob"></span>
		</div>
	{/if}
	{#if tip}
		<div class="tip" style:left="{Math.max(130, Math.min(width - 130, hoverX))}px">
			<div class="tip-head">
				<b>{tip.user}</b>
				<span class="d" class:neg={tip.delta < 0}>{formatDelta(tip.delta)}</span>
			</div>
			<div class="tip-date">#{tipIdx + 1} · {formatDate(tip.timestamp)}</div>
			{#if tip.comment}<div class="tip-comment">{cleanComment(tip.comment).text || cleanComment(tip.comment).section}</div>{/if}
		</div>
	{/if}
</div>

<style>
	.timeline {
		position: relative;
		width: 100%;
		user-select: none;
	}
	canvas {
		display: block;
		width: 100%;
		cursor: pointer;
		touch-action: none;
	}
	.playhead {
		position: absolute;
		top: 0;
		left: -1px;
		width: 2px;
		height: 62px;
		background: var(--accent);
		pointer-events: none;
		border-radius: 2px;
		transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.playhead.start {
		opacity: 0.5;
	}
	.knob {
		position: absolute;
		top: -5px;
		left: 50%;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--accent);
		border: 2px solid var(--paper);
		transform: translateX(-50%);
	}
	.tip {
		position: absolute;
		bottom: calc(100% + 10px);
		width: 250px;
		transform: translateX(-50%);
		padding: 9px 11px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--paper);
		box-shadow: var(--shadow);
		font-size: 12px;
		pointer-events: none;
		z-index: 30;
	}
	.tip-head {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}
	.tip-head b {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.d {
		color: var(--tm-ins);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.d.neg {
		color: var(--tm-del);
	}
	.tip-date {
		color: var(--muted);
		margin-top: 2px;
	}
	.tip-comment {
		margin-top: 5px;
		line-height: 1.4;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
