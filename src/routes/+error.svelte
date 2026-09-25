<script lang="ts">
	import { page } from '$app/state';
	import SearchBox from '$lib/components/SearchBox.svelte';
</script>

<main>
	<div class="code">{page.status}</div>
	<h1>{page.error?.message ?? 'Something went wrong'}</h1>
	<p>Try searching for another article.</p>
	<SearchBox big />
	<a href="/">← Home</a>
</main>

<style>
	main {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 20px;
		text-align: center;
	}
	.code {
		font: 500 72px/1 var(--serif);
		color: var(--muted);
	}
	h1 {
		margin: 0;
		font: 500 26px var(--serif);
	}
	p {
		color: var(--muted);
		margin: 0 0 12px;
	}
</style>
