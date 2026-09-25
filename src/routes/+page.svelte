<script lang="ts">
	import { onMount } from 'svelte';
	import SearchBox from '$lib/components/SearchBox.svelte';
	import { Stage } from '$lib/animator';
	import { planBlocks } from '$lib/diff';
	import type { Block } from '$lib/wikitext';

	const LANGS = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'pl', 'sv', 'ja', 'ru', 'zh', 'vi'];
	let lang = $state('en');

	const examples = ['Svelte', 'Cat', 'Mount Everest', 'Linux', 'Pizza', 'Moon landing', 'Rubber duck'];

	// A tiny scripted history that loops in the hero to show off the effects.
	const P1a = 'The cat is a small domestic speceis of mammal.';
	const P1b = 'The cat is a small domestic species of mammal.';
	const P1c = 'The cat is a small domesticated species of carnivorous mammal.';
	const P1d = 'The cat (Felis catus) is a small domesticated species of carnivorous mammal.';
	const P2a = 'Cats are loved for their companionship and their ability to hunt vermin.';
	const P2b = 'Cats are valued for companionship and their ability to hunt vermin.';
	const IMG1: Block = { type: 'img', file: 'Cat August 2010-4.jpg', text: 'A tabby cat' };
	const IMG2: Block = { type: 'img', file: 'Kittyply edit1.jpg', text: 'Whiskers up close' };
	const p = (text: string): Block => ({ type: 'p', text });

	// A tiny scripted history that loops in the hero to show off the effects.
	const script: { user: string; blocks: Block[] }[] = [
		{ user: 'Newbie42', blocks: [p(P1a)] },
		{ user: 'Newbie42', blocks: [p(P1b)] },
		{ user: 'FelineFan', blocks: [p(P1c)] },
		{ user: 'PhotoBuff', blocks: [IMG1, p(P1c)] },
		{ user: 'FelineFan', blocks: [IMG1, p(P1c), p(P2a)] },
		{ user: 'Copyeditor', blocks: [IMG2, p(P1d), p(P2b)] },
		{ user: 'Vandal123', blocks: [p(P1d), p(P2b)] }
	];

	const demoImages = new Map([
		[
			IMG1.file!,
			{
				url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Cat_August_2010-4.jpg/500px-Cat_August_2010-4.jpg',
				w: 480,
				h: 294
			}
		],
		[
			IMG2.file!,
			{
				url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/Kittyply_edit1.jpg/500px-Kittyply_edit1.jpg',
				w: 480,
				h: 320
			}
		]
	]);

	let root: HTMLDivElement;
	let content: HTMLDivElement;
	let caption = $state(script[0].user);

	onMount(() => {
		const stage = new Stage(root, content);
		stage.speed = 0.9;
		stage.images = demoImages;
		for (const { url } of demoImages.values()) new Image().src = url;
		let i = 0;
		let alive = true;
		stage.renderStatic(script[0].blocks);
		(async () => {
			await new Promise((r) => setTimeout(r, 900));
			while (alive) {
				const j = (i + 1) % script.length;
				caption = script[j].user;
				if (j === 0) {
					stage.renderStatic(script[0].blocks);
					await new Promise((r) => setTimeout(r, 1200));
				} else {
					await stage.transition(script[j].blocks, planBlocks(script[i].blocks, script[j].blocks), script[j].user);
					await new Promise((r) => setTimeout(r, 1300));
				}
				i = j;
			}
		})();
		return () => {
			alive = false;
			stage.cancel();
		};
	});
</script>

<svelte:head>
	<title>Wiki Time Machine</title>
	<meta name="description" content="Read Wikipedia and replay every edit of an article as an animation." />
</svelte:head>

<main>
	<div class="hero">
		<div class="brand">
			<span class="logo">W</span>
			<span class="clock" aria-hidden="true"></span>
		</div>
		<h1>Wiki Time Machine</h1>
		<p class="lede">Read any Wikipedia article, then watch it write itself, edit by edit, from the first draft to today.</p>

		<div class="bar">
			<SearchBox {lang} big autofocus />
			<select bind:value={lang} aria-label="Language">
				{#each LANGS as l (l)}<option value={l}>{l}</option>{/each}
			</select>
		</div>

		<div class="examples">
			<span>Try</span>
			{#each examples as ex (ex)}
				<a href="/wiki/{ex.replace(/ /g, '_')}{lang === 'en' ? '' : `?lang=${lang}`}">{ex}</a>
			{/each}
		</div>
	</div>

	<section class="demo" aria-label="Animation preview">
		<div class="demo-head">
			<span class="dot"></span><span class="dot"></span><span class="dot"></span>
			<span class="demo-title">Cat — edit by <b>{caption}</b></span>
		</div>
		<div class="demo-stage" bind:this={root}>
			<div class="tm-content demo-content" bind:this={content}></div>
		</div>
	</section>
</main>

<style>
	main {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 12vh 20px 60px;
		background:
			radial-gradient(1200px 500px at 50% -10%, var(--accent-soft), transparent 70%),
			var(--bg);
	}
	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 100%;
		max-width: 760px;
		text-align: center;
	}
	.brand {
		position: relative;
		margin-bottom: 18px;
	}
	.logo {
		display: grid;
		place-items: center;
		width: 64px;
		height: 64px;
		border-radius: 18px;
		background: var(--text);
		color: var(--bg);
		font: 500 38px var(--serif);
		box-shadow: var(--shadow);
	}
	.clock {
		position: absolute;
		right: -8px;
		top: -8px;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--tm-ins);
		border: 3px solid var(--bg);
	}
	.clock::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 3px;
		width: 2px;
		height: 6px;
		background: var(--bg);
		transform-origin: 50% 100%;
		animation: tick 4s linear infinite;
	}
	@keyframes tick {
		to {
			transform: rotate(360deg);
		}
	}
	h1 {
		margin: 0;
		font: 500 clamp(34px, 6vw, 56px) / 1.05 var(--serif);
		letter-spacing: -0.02em;
	}
	.lede {
		max-width: 540px;
		margin: 14px 0 30px;
		color: var(--muted);
		font-size: 17px;
		line-height: 1.55;
	}
	.bar {
		display: flex;
		gap: 10px;
		width: 100%;
		justify-content: center;
	}
	select {
		height: 60px;
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: var(--paper);
		color: var(--text);
		font: 15px var(--sans);
		box-shadow: var(--shadow);
	}
	.examples {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
		margin-top: 18px;
		font-size: 14px;
		color: var(--muted);
		align-items: center;
	}
	.examples a {
		padding: 5px 12px;
		border-radius: 999px;
		background: var(--chip);
		color: var(--text);
		transition: background 0.2s;
	}
	.examples a:hover {
		background: var(--accent-soft);
		text-decoration: none;
	}
	.demo {
		width: 100%;
		max-width: 680px;
		margin-top: 56px;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: var(--paper);
		box-shadow: var(--shadow);
		overflow: hidden;
	}
	.demo-head {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 10px 14px;
		border-bottom: 1px solid var(--line);
		font-size: 12.5px;
		color: var(--muted);
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--line);
	}
	.demo-title {
		margin-left: 8px;
	}
	.demo-stage {
		height: 300px;
		overflow: hidden;
	}
	.demo-content :global(.blk-img) {
		width: 190px;
	}
	.demo-content {
		padding: 44px 30px 30px;
		font-size: 21px;
	}
</style>
