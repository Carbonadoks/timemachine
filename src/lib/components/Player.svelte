<script lang="ts">
	import { onMount } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { Stage } from '$lib/animator';
	import { sfx } from '$lib/sfx';
	import type { History } from '$lib/history.svelte';
	import { cleanComment, formatDate, formatDateTime, formatDelta, isRevert, userHue } from '$lib/format';

	let { history }: { history: History } = $props();

	let root: HTMLDivElement;
	let content: HTMLDivElement;

	onMount(() => {
		const stage = new Stage(root, content);
		stage.onSound = (kind, delay) => sfx.play(kind, delay);
		history.attach(stage);
		return () => history.detach();
	});

	const cur = $derived(history.current);
	const comment = $derived(cur ? cleanComment(cur.comment) : null);
	const first = $derived(history.revisions[0]);

	// ─── edit feed (virtualised) ────────────────────────────────────────────
	const ROW = 62;
	let feed: HTMLDivElement;
	let feedTop = $state(0);
	let feedH = $state(600);
	const n = $derived(history.revisions.length);
	const startRow = $derived(Math.max(0, Math.floor(feedTop / ROW) - 6));
	const endRow = $derived(Math.min(n, Math.ceil((feedTop + feedH) / ROW) + 6));
	const rows = $derived(
		Array.from({ length: Math.max(0, endRow - startRow) }, (_, k) => {
			const i = n - 1 - (startRow + k); // newest first
			return { i, r: history.revisions[i] };
		})
	);

	$effect(() => {
		const i = history.index;
		if (!feed || i < 0) return;
		const y = (n - 1 - i) * ROW;
		const target = y - feed.clientHeight / 2 + ROW / 2;
		const near = Math.abs(feed.scrollTop - target) < feed.clientHeight * 2;
		feed.scrollTo({ top: target, behavior: near ? 'smooth' : 'instant' });
	});
</script>

{#snippet card()}
	{#if cur}
		{#key cur.revid}
			<div class="card" in:fly={{ y: -14, duration: 380, easing: cubicOut }} out:fade={{ duration: 120 }}>
				<div class="avatar" style:--hue={userHue(cur.user)}>{cur.user.slice(0, 1).toUpperCase()}</div>
				<div class="card-body">
					<div class="card-top">
						<b class="user" title={cur.user}>{cur.user}</b>
						{#if cur.anon}<span class="tag">IP</span>{/if}
						{#if cur.minor}<span class="tag">minor</span>{/if}
						{#if isRevert(cur.comment)}<span class="tag revert">revert</span>{/if}
						<span class="delta" class:neg={cur.delta < 0}>{formatDelta(cur.delta)} B</span>
					</div>
					<div class="when">{formatDateTime(cur.timestamp)} · edit #{(history.index + 1).toLocaleString('en')}</div>
					{#if comment?.section}<span class="section">§ {comment.section}</span>{/if}
					{#if comment?.text}<p class="comment">{comment.text}</p>{:else if !comment?.section}<p
							class="comment none">No edit summary</p>{/if}
					{#if history.plan}
						<div class="stats">
							{#if history.plan.wordsAdded}<span class="s-add">+{history.plan.wordsAdded} words</span>{/if}
							{#if history.plan.wordsRemoved}<span class="s-del">−{history.plan.wordsRemoved} words</span>{/if}
							{#if history.plan.fixes}<span class="s-fix">✦ {history.plan.fixes} fix{history.plan.fixes > 1 ? 'es' : ''}</span>{/if}
							{#if !history.plan.changed}<span class="s-none">no visible text change</span>{/if}
						</div>
					{/if}
				</div>
			</div>
		{/key}
	{:else}
		<div class="card idle">Press play to replay every edit. Details of each edit show up here.</div>
	{/if}
{/snippet}

<div class="player">
	<div class="stage-wrap">
		<div class="stage" bind:this={root}>
			<div class="tm-content" bind:this={content}></div>
		</div>

		{#if !history.loadingMeta && !n}
			<div class="empty" transition:fade={{ duration: 250 }}>
				<div class="empty-card">
					<div class="big-date">Nothing here yet</div>
					<p>{history.title.startsWith('Talk:') ? 'Nobody has started a discussion on this article’s talk page.' : 'This page has no revisions.'}</p>
				</div>
			</div>
		{:else if history.index < 0 && first}
			<div class="empty" transition:fade={{ duration: 250 }}>
				<div class="empty-card">
					<div class="big-date">{formatDate(first.timestamp)}</div>
					<p>
						{history.title.startsWith('Talk:') ? 'The talk page' : 'This article'} was created by <b>{first.user}</b>. Since then it has been edited
						<b>{n.toLocaleString('en')}</b>{history.loadingMeta ? '+' : ''} times.
					</p>
					<button class="cta" onclick={() => history.play()}>
						<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
						Watch it being written
					</button>
				</div>
			</div>
		{/if}

		<div class="card-overlay">{@render card()}</div>

		{#if history.fetching}
			<div class="loading" transition:fade={{ duration: 150 }}><span class="spinner"></span>Fetching revisions…</div>
		{/if}
	</div>

	<aside class="side">
		<div class="card-slot">{@render card()}</div>
		<div class="feed-label">
			{history.title.startsWith('Talk:') ? 'Talk page history' : 'Edit history'} · {n.toLocaleString('en')}{history.loadingMeta ? '…' : ''}
		</div>
		<div class="feed" bind:this={feed} bind:clientHeight={feedH} onscroll={() => (feedTop = feed.scrollTop)}>
		<div class="feed-inner" style:height="{n * ROW}px">
			{#each rows as { i, r } (r.revid)}
				<button
					class="row"
					class:active={i === history.index}
					class:future={i > history.index}
					style:transform="translateY({(n - 1 - i) * ROW}px)"
					class:pending={i === history.pending}
					onclick={() => history.playEdit(i)}
					onmouseenter={() => history.warm(i)}
					title="Replay this edit"
				>
					<span class="row-top">
						<span class="replay" aria-hidden="true">▶</span>
						<b>{r.user}</b>
						<span class="delta" class:neg={r.delta < 0}>{formatDelta(r.delta)}</span>
					</span>
					<span class="row-date">{formatDate(r.timestamp)}</span>
					<span class="row-comment">{cleanComment(r.comment).text || cleanComment(r.comment).section || '—'}</span>
				</button>
			{/each}
		</div>
		</div>
	</aside>
</div>

<style>
	.player {
		display: grid;
		grid-template-columns: 1fr 300px;
		height: 100%;
		min-height: 0;
	}
	.stage-wrap {
		position: relative;
		min-width: 0;
		min-height: 0;
	}
	.stage {
		position: absolute;
		inset: 0;
		overflow-y: auto;
		overflow-x: hidden;
		scrollbar-width: thin;
	}

	.card {
		display: flex;
		gap: 12px;
		padding: 14px;
		border: 1px solid var(--line);
		border-radius: 14px;
		background: color-mix(in srgb, var(--paper) 88%, transparent);
		backdrop-filter: blur(12px);
		box-shadow: var(--shadow);
		font-size: 13px;
	}
	.side {
		display: flex;
		flex-direction: column;
		min-height: 0;
		border-left: 1px solid var(--line);
		background: var(--paper);
	}
	.card-slot {
		display: grid;
		padding: 12px;
		min-height: 150px;
	}
	.card-slot > :global(*),
	.card-overlay > :global(*) {
		grid-area: 1 / 1;
	}
	.card-overlay {
		display: none;
	}
	.feed-label {
		padding: 6px 14px;
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.card.idle {
		align-items: center;
		color: var(--muted);
		line-height: 1.5;
		box-shadow: none;
		border-style: dashed;
	}
	.avatar {
		flex: none;
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: hsl(var(--hue) 70% 50%);
		color: #fff;
		font-weight: 700;
		font-size: 15px;
	}
	.card-body {
		min-width: 0;
		flex: 1;
	}
	.card-top {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.user {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tag {
		padding: 1px 6px;
		border-radius: 999px;
		background: var(--chip);
		color: var(--muted);
		font-size: 10.5px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.tag.revert {
		background: color-mix(in srgb, var(--tm-del) 16%, transparent);
		color: var(--tm-del);
	}
	.delta {
		margin-left: auto;
		color: var(--tm-ins);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.delta.neg {
		color: var(--tm-del);
	}
	.when {
		color: var(--muted);
		font-size: 12px;
		margin: 2px 0 6px;
	}
	.section {
		display: inline-block;
		padding: 1px 7px;
		border-radius: 6px;
		background: var(--accent-soft);
		color: var(--accent);
		font-size: 11.5px;
		font-weight: 600;
		margin-bottom: 4px;
	}
	.comment {
		margin: 0;
		line-height: 1.45;
		display: -webkit-box;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.comment.none {
		color: var(--muted);
		font-style: italic;
	}
	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 8px;
		font-size: 11.5px;
		font-weight: 600;
	}
	.s-add {
		color: var(--tm-ins);
	}
	.s-del {
		color: var(--tm-del);
	}
	.s-fix {
		color: var(--tm-spark);
	}
	.s-none {
		color: var(--muted);
		font-weight: 500;
	}

	.empty {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		z-index: 15;
		padding: 20px;
	}
	.empty-card {
		max-width: 420px;
		text-align: center;
		color: var(--muted);
		font-size: 15px;
		line-height: 1.55;
	}
	.big-date {
		font: 500 40px/1.1 var(--serif);
		color: var(--text);
		margin-bottom: 10px;
	}
	.cta {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		margin-top: 12px;
		padding: 12px 22px 12px 18px;
		border: 0;
		border-radius: 999px;
		background: var(--text);
		color: var(--bg);
		font-weight: 600;
		cursor: pointer;
		box-shadow: var(--shadow);
		transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.cta:hover {
		transform: scale(1.05);
	}
	.cta svg {
		width: 18px;
		height: 18px;
		fill: currentColor;
	}

	.loading {
		position: absolute;
		left: 50%;
		bottom: 18px;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 14px;
		border-radius: 999px;
		background: var(--paper);
		border: 1px solid var(--line);
		box-shadow: var(--shadow);
		font-size: 12.5px;
		z-index: 20;
	}
	.spinner {
		width: 12px;
		height: 12px;
		border: 2px solid var(--line);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.feed {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		scrollbar-width: thin;
	}
	.feed-inner {
		position: relative;
	}
	.row {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: 62px;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 8px 14px;
		border: 0;
		border-bottom: 1px solid var(--line);
		background: none;
		text-align: left;
		cursor: pointer;
		font-size: 12px;
		transition:
			background 0.25s,
			opacity 0.25s;
	}
	.row:hover {
		background: var(--accent-soft);
	}
	.row.pending .replay {
		width: 16px;
		opacity: 1;
		margin-right: 0;
		background: transparent;
		border: 2px solid var(--line);
		border-top-color: var(--accent);
		color: transparent;
		animation: spin 0.7s linear infinite;
	}
	.row.future {
		opacity: 0.45;
	}
	.row.active {
		background: var(--accent-soft);
		box-shadow: inset 3px 0 0 var(--accent);
		opacity: 1;
	}
	.row-top {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.replay {
		display: grid;
		place-items: center;
		flex: none;
		width: 0;
		height: 16px;
		overflow: hidden;
		border-radius: 50%;
		background: var(--accent);
		color: var(--paper);
		font-size: 7px;
		opacity: 0;
		margin-right: -8px;
		transition:
			width 0.2s,
			opacity 0.2s,
			margin 0.2s;
	}
	.row:hover .replay,
	.row.active .replay {
		width: 16px;
		opacity: 1;
		margin-right: 0;
	}
	.row-top b {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row-date {
		color: var(--muted);
		font-size: 11px;
	}
	.row-comment {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
		opacity: 0.8;
	}

	@media (max-width: 1000px) {
		.player {
			grid-template-columns: 1fr;
		}
		.side {
			display: none;
		}
		.card-overlay {
			display: grid;
			position: absolute;
			left: 12px;
			right: 12px;
			bottom: 12px;
			z-index: 20;
		}
	}
</style>
