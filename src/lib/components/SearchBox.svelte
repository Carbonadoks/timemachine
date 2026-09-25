<script lang="ts">
	import { goto } from '$app/navigation';
	import { searchTitles } from '$lib/wiki';

	let { lang = 'en', big = false, autofocus = false }: { lang?: string; big?: boolean; autofocus?: boolean } = $props();

	type Hit = Awaited<ReturnType<typeof searchTitles>>[number];
	let q = $state('');
	let hits = $state<Hit[]>([]);
	let active = $state(-1);
	let open = $state(false);
	let ctrl: AbortController | null = null;
	let timer: ReturnType<typeof setTimeout>;

	function onInput() {
		clearTimeout(timer);
		const query = q.trim();
		if (!query) {
			hits = [];
			return;
		}
		timer = setTimeout(async () => {
			ctrl?.abort();
			ctrl = new AbortController();
			try {
				hits = await searchTitles(query, lang, ctrl.signal);
				active = -1;
				open = true;
			} catch {
				/* aborted */
			}
		}, 140);
	}

	function go(title: string) {
		open = false;
		q = '';
		hits = [];
		const qs = lang === 'en' ? '' : `?lang=${lang}`;
		goto(`/wiki/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/')}${qs}`);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			active = Math.min(hits.length - 1, active + 1);
			e.preventDefault();
		} else if (e.key === 'ArrowUp') {
			active = Math.max(-1, active - 1);
			e.preventDefault();
		} else if (e.key === 'Enter') {
			const pick = hits[active] ?? hits[0];
			if (pick) go(pick.title);
			else if (q.trim()) go(q.trim());
		} else if (e.key === 'Escape') open = false;
	}
</script>

<div class="search" class:big>
	<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"
		><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg
	>
	<!-- svelte-ignore a11y_autofocus -->
	<input
		bind:value={q}
		oninput={onInput}
		onkeydown={onKey}
		onfocus={() => (open = hits.length > 0)}
		onblur={() => setTimeout(() => (open = false), 150)}
		placeholder="Search Wikipedia…"
		spellcheck="false"
		autocomplete="off"
		{autofocus}
		aria-label="Search Wikipedia"
	/>
	{#if open && hits.length}
		<ul class="hits" role="listbox">
			{#each hits as hit, i (hit.key)}
				<li role="option" aria-selected={i === active}>
					<button class:active={i === active} onmousedown={() => go(hit.title)}>
						{#if hit.thumbnail?.url}
							<img src={hit.thumbnail.url.replace(/^\/\//, 'https://')} alt="" />
						{:else}
							<span class="ph">{hit.title[0]}</span>
						{/if}
						<span class="txt">
							<strong>{hit.title}</strong>
							{#if hit.description}<small>{hit.description}</small>{/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.search {
		position: relative;
		width: 100%;
		max-width: 420px;
	}
	.search.big {
		max-width: 620px;
	}
	.icon {
		position: absolute;
		left: 12px;
		top: 50%;
		width: 17px;
		height: 17px;
		transform: translateY(-50%);
		fill: none;
		stroke: var(--muted);
		stroke-width: 2;
		stroke-linecap: round;
		pointer-events: none;
	}
	.big .icon {
		left: 20px;
		width: 22px;
		height: 22px;
	}
	input {
		width: 100%;
		height: 38px;
		padding: 0 14px 0 38px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--paper);
		color: var(--text);
		font: 15px var(--sans);
		outline: none;
		transition:
			border-color 0.2s,
			box-shadow 0.2s;
	}
	.big input {
		height: 60px;
		padding-left: 54px;
		font-size: 19px;
		border-radius: 16px;
		box-shadow: var(--shadow);
	}
	input:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 4px var(--accent-soft);
	}
	.hits {
		position: absolute;
		z-index: 50;
		top: calc(100% + 6px);
		left: 0;
		right: 0;
		margin: 0;
		padding: 6px;
		list-style: none;
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 12px;
		box-shadow: var(--shadow);
		animation: pop 0.18s cubic-bezier(0.22, 1, 0.36, 1);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(-4px) scale(0.99);
		}
	}
	.hits button {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 7px 8px;
		border: 0;
		border-radius: 8px;
		background: none;
		text-align: left;
		cursor: pointer;
	}
	.hits button:hover,
	.hits button.active {
		background: var(--accent-soft);
	}
	.hits img,
	.ph {
		flex: none;
		width: 36px;
		height: 36px;
		border-radius: 6px;
		object-fit: cover;
		background: var(--chip);
	}
	.ph {
		display: grid;
		place-items: center;
		font-family: var(--serif);
		color: var(--muted);
	}
	.txt {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.txt strong {
		font-weight: 600;
		font-size: 14px;
	}
	.txt small {
		color: var(--muted);
		font-size: 12.5px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
