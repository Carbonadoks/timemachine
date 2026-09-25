<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { page } from '$app/state';
	import { dev } from '$app/environment';
	import SearchBox from './SearchBox.svelte';
	import Player from './Player.svelte';
	import Timeline from './Timeline.svelte';
	import WikiArticle from './WikiArticle.svelte';
	import { History, type StepMode } from '$lib/history.svelte';
	import { formatDate } from '$lib/format';
	import { sfx } from '$lib/sfx';
	import type { Article } from '$lib/wiki';

	let { article }: { article: Article } = $props();

	// One history per source page; the talk page is only loaded when first opened.
	let articleHistory = $state<History | null>(null);
	let talkHistory = $state<History | null>(null);
	let source = $state<'article' | 'talk'>(page.url.searchParams.get('source') === 'talk' ? 'talk' : 'article');
	const history = $derived(source === 'talk' ? talkHistory : articleHistory);
	let mode = $state<'read' | 'machine'>(page.url.searchParams.get('view') === 'history' ? 'machine' : 'read');

	const SPEEDS = [0.5, 1, 2, 4, 8, 16, 32];
	const STEPS: { v: StepMode; label: string }[] = [
		{ v: 'edit', label: 'Every edit' },
		{ v: 'day', label: 'Daily' },
		{ v: 'month', label: 'Monthly' },
		{ v: 'year', label: 'Yearly' }
	];

	let sound = $state(false);
	function toggleSound() {
		sound = !sound;
		sfx.setEnabled(sound);
	}

	onMount(() => {
		sound = sfx.enabled;
		articleHistory = new History(article.title, article.lang);
		articleHistory.loadMeta();
		if (source === 'talk') ensureTalk();
		// ?at=<timestamp>: open the time machine on the version from that moment (links in the replay use this).
		const at = page.url.searchParams.get('at');
		if (at && /^\d{4}-\d\d-\d\dT[\d:]+Z$/.test(at)) history?.seekTime(at);
		// Dev-only handle for scripted demos/tests (e.g. the how-to video recorder).
		if (dev) (window as unknown as { __tm: unknown }).__tm = { get history() { return history; } };
		return () => {
			articleHistory?.destroy();
			talkHistory?.destroy();
		};
	});

	function ensureTalk() {
		if (talkHistory) return;
		// "Talk:" is the canonical namespace name and works on every language edition.
		talkHistory = new History(`Talk:${article.title}`, article.lang);
		talkHistory.loadMeta();
	}

	function setSource(s: 'article' | 'talk') {
		if (s === source) return;
		history?.pause();
		if (s === 'talk') ensureTalk();
		source = s;
		mode = 'machine';
	}

	const wikiUrl = $derived(`https://${article.lang}.wikipedia.org/wiki/${encodeURIComponent(article.title.replace(/ /g, '_'))}`);
	const n = $derived(history?.revisions.length ?? 0);

	function openMachine() {
		mode = 'machine';
	}
	function playPause() {
		if (!history) return;
		if (mode !== 'machine') {
			mode = 'machine';
			history.play(); // starts once the stage attaches
			return;
		}
		history.toggle();
	}
	function seek(i: number) {
		openMachine();
		history?.playFrom(i);
	}

	function onKey(e: KeyboardEvent) {
		const t = e.target as HTMLElement;
		if (t.closest('input, select, textarea') || !history) return;
		if (e.key === ' ') {
			e.preventDefault();
			playPause();
		} else if (mode === 'machine' && e.key === 'ArrowRight') {
			e.preventDefault();
			history.stepForward();
		} else if (mode === 'machine' && e.key === 'ArrowLeft') {
			e.preventDefault();
			history.stepBack();
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<svelte:head>
	<title>{article.title} · Wiki Time Machine</title>
</svelte:head>

<div class="shell">
	<header class="top">
		<a class="brand" href="/" aria-label="Home"><span class="logo">W</span><span class="name">Time Machine</span></a>
		<SearchBox lang={article.lang} />
		<a class="ext" href={wikiUrl} target="_blank" rel="noopener">View on Wikipedia ↗</a>
	</header>

	<div class="titlebar">
		<div class="titlebar-inner">
			<h1>{@html article.displayTitle}</h1>
			<div class="tabs" role="tablist">
				<button role="tab" aria-selected={mode === 'read'} class:on={mode === 'read'} onclick={() => (mode = 'read')}>Article</button>
				<button role="tab" aria-selected={mode === 'machine'} class:on={mode === 'machine'} onclick={openMachine}>
					<span class="pulse" class:live={history?.playing}></span>Time machine
				</button>
			</div>
		</div>
	</div>

	<main class:machine={mode === 'machine'}>
		{#if mode === 'read'}
			<div class="read" in:fade={{ duration: 180 }}>
				<WikiArticle html={article.html} lang={article.lang} />
				<footer class="credit">
					Content from <a href={wikiUrl} target="_blank" rel="noopener">Wikipedia</a>, licensed under
					<a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.
					<a href="https://github.com/Carbonadoks/timemachine" target="_blank" rel="noopener">Source on GitHub</a>.
				</footer>
			</div>
		{:else if history}
			{#key history}
				<div class="machine-wrap" in:fade={{ duration: 180 }}>
					<Player {history} />
				</div>
			{/key}
		{/if}
	</main>

	<footer class="dock">
		<div class="controls">
			<div class="transport">
				<button class="ctl" onclick={() => history?.stepBack()} disabled={!n} aria-label="Previous edit" title="Previous edit (←)">
					<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
				</button>
				<button class="play" onclick={playPause} disabled={!n} aria-label={history?.playing ? 'Pause' : 'Play history'} title="Play / pause (space)">
					{#if history?.playing}
						<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z" /></svg>
					{:else}
						<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
					{/if}
				</button>
				<button class="ctl" onclick={() => { openMachine(); history?.stepForward(); }} disabled={!n} aria-label="Next edit" title="Next edit (→)">
					<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6zM16 6h2v12h-2z" /></svg>
				</button>
			</div>

			<div class="seg source" role="radiogroup" aria-label="History source">
				<button role="radio" aria-checked={source === 'article'} class:on={source === 'article'} onclick={() => setSource('article')}>Article</button>
				<button role="radio" aria-checked={source === 'talk'} class:on={source === 'talk'} onclick={() => setSource('talk')}>Talk</button>
			</div>

			<div class="status">
				{#if history?.error}
					<span class="err">⚠ {history.error}</span>
				{:else if !history || (history.loadingMeta && !n)}
					<span class="muted">Loading edit history…</span>
				{:else if !n}
					<span class="muted">{source === 'talk' ? 'This article has no talk page yet.' : 'No edits found.'}</span>
				{:else if history.current}
					<b>Edit {(history.index + 1).toLocaleString('en')}</b>
					<span class="muted">of {n.toLocaleString('en')}{history.loadingMeta ? '+' : ''} · {formatDate(history.current.timestamp)}</span>
				{:else}
					<b>{n.toLocaleString('en')}{history.loadingMeta ? '+' : ''} edits</b>
					<span class="muted">since {formatDate(history.revisions[0].timestamp)}</span>
				{/if}
				{#if history?.loadingMeta && n}<span class="chip">loading… {n.toLocaleString('en')}</span>{/if}
			</div>

			<div class="opts">
				<button
					class="sound"
					class:on={sound}
					onclick={toggleSound}
					aria-pressed={sound}
					aria-label={sound ? 'Turn sound effects off' : 'Turn sound effects on'}
					title={sound ? 'Sound effects on' : 'Sound effects off'}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path class="spk" d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
						{#if sound}
							<path class="wave w1" d="M15 9.2a4 4 0 0 1 0 5.6" />
							<path class="wave w2" d="M17.6 6.8a7.5 7.5 0 0 1 0 10.4" />
						{:else}
							<path class="x" d="M15.5 9.5l5 5m0-5l-5 5" />
						{/if}
					</svg>
					<span>Sound</span>
				</button>
				<div class="seg" role="radiogroup" aria-label="Speed">
					{#each SPEEDS as s (s)}
						<button role="radio" aria-checked={history?.speed === s} class:on={history?.speed === s} onclick={() => history?.setSpeed(s)}>{s}×</button>
					{/each}
				</div>
				{#if history}
					<select bind:value={history.step} aria-label="Playback granularity">
						{#each STEPS as st (st.v)}<option value={st.v}>{st.label}</option>{/each}
					</select>
				{/if}
			</div>
		</div>
		<Timeline revisions={history?.revisions ?? []} index={history?.index ?? -1} onseek={seek} onhover={(i) => history?.warm(i + 1)} />
	</footer>
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		height: 100dvh;
	}
	.top {
		display: flex;
		align-items: center;
		gap: 18px;
		padding: 10px 20px;
		border-bottom: 1px solid var(--line);
		background: var(--paper);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--text);
		flex: none;
	}
	.brand:hover {
		text-decoration: none;
	}
	.logo {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: 9px;
		background: var(--text);
		color: var(--bg);
		font: 500 20px var(--serif);
	}
	.name {
		font-weight: 600;
		font-size: 15px;
	}
	.ext {
		margin-left: auto;
		font-size: 13px;
		white-space: nowrap;
	}

	.titlebar {
		border-bottom: 1px solid var(--line);
		background: var(--bg);
	}
	.titlebar-inner {
		display: flex;
		align-items: flex-end;
		gap: 20px;
		max-width: 1100px;
		margin: 0 auto;
		padding: 14px 28px 0;
	}
	h1 {
		flex: 1;
		margin: 0 0 10px;
		font: 500 clamp(24px, 3.2vw, 34px) / 1.15 var(--serif);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tabs {
		display: flex;
		gap: 4px;
	}
	.tabs button {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 8px 14px 10px;
		border: 0;
		border-bottom: 2px solid transparent;
		background: none;
		color: var(--muted);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition:
			color 0.2s,
			border-color 0.2s;
	}
	.tabs button.on {
		color: var(--text);
		border-bottom-color: var(--accent);
	}
	.pulse {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--muted);
		opacity: 0.5;
	}
	.pulse.live {
		background: var(--tm-ins);
		opacity: 1;
		animation: pulse 1.2s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			box-shadow: 0 0 0 5px color-mix(in srgb, var(--tm-ins) 25%, transparent);
		}
	}

	main {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		position: relative;
	}
	main.machine {
		overflow: hidden;
	}
	.read {
		max-width: 1100px;
		margin: 0 auto;
		padding: 24px 28px 60px;
	}
	.machine-wrap {
		height: 100%;
	}
	.credit {
		margin-top: 40px;
		padding-top: 16px;
		border-top: 1px solid var(--line);
		color: var(--muted);
		font-size: 12.5px;
	}

	.dock {
		flex: none;
		padding: 10px 20px 8px;
		border-top: 1px solid var(--line);
		background: var(--paper);
		box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.04);
	}
	.controls {
		display: flex;
		align-items: center;
		gap: 18px;
		margin-bottom: 8px;
	}
	.transport {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.ctl,
	.play {
		display: grid;
		place-items: center;
		border: 0;
		cursor: pointer;
		transition:
			transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
			background 0.2s;
	}
	.ctl {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: none;
		color: var(--muted);
	}
	.ctl:hover:not(:disabled) {
		background: var(--chip);
		color: var(--text);
	}
	.play {
		width: 42px;
		height: 42px;
		border-radius: 50%;
		background: var(--text);
		color: var(--bg);
	}
	.play:hover:not(:disabled) {
		transform: scale(1.08);
	}
	button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.ctl svg,
	.play svg {
		width: 18px;
		height: 18px;
		fill: currentColor;
	}
	.play svg {
		width: 20px;
		height: 20px;
	}
	.status {
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex: 1;
		min-width: 0;
		font-size: 13.5px;
		white-space: nowrap;
		overflow: hidden;
	}
	.muted {
		color: var(--muted);
	}
	.err {
		color: var(--tm-del);
	}
	.chip {
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--chip);
		color: var(--muted);
		font-size: 11px;
	}
	.opts {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.sound {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 11px 0 8px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--paper);
		color: var(--muted);
		font-size: 12.5px;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 0.2s,
			color 0.2s,
			border-color 0.2s,
			transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.sound:hover {
		color: var(--text);
	}
	.sound:active {
		transform: scale(0.94);
	}
	.sound.on {
		background: var(--accent-soft);
		border-color: var(--accent);
		color: var(--accent);
	}
	.sound svg {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.sound .spk {
		fill: currentColor;
	}
	.sound .wave {
		animation: wave-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
		transform-origin: 12px 12px;
	}
	.sound .w2 {
		animation-delay: 0.08s;
	}
	@keyframes wave-in {
		from {
			opacity: 0;
			transform: scale(0.6);
		}
	}
	.seg {
		display: flex;
		padding: 2px;
		border-radius: 9px;
		background: var(--chip);
	}
	.seg button {
		padding: 4px 8px;
		border: 0;
		border-radius: 7px;
		background: none;
		color: var(--muted);
		font-size: 12px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
	}
	.seg.source button {
		font-size: 12.5px;
		padding: 5px 11px;
	}
	.seg button.on {
		background: var(--paper);
		color: var(--text);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
	}
	select {
		height: 30px;
		padding: 0 8px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--paper);
		color: var(--text);
		font: 12.5px var(--sans);
	}

	@media (max-width: 800px) {
		.name,
		.ext {
			display: none;
		}
		.top {
			padding: 8px 12px;
		}
		.titlebar-inner {
			padding: 10px 16px 0;
			flex-direction: column;
			align-items: stretch;
			gap: 0;
		}
		.read {
			padding: 18px 16px 40px;
		}
		.dock {
			padding: 8px 12px 6px;
		}
		.controls {
			flex-wrap: wrap;
			gap: 8px 12px;
		}
		.opts {
			width: 100%;
			justify-content: space-between;
		}
		.seg button {
			padding: 4px 6px;
		}
	}
</style>
