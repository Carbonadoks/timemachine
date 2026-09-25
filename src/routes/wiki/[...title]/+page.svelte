<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import WikiPage from '$lib/components/WikiPage.svelte';

	let { data } = $props();

	// SSR could not reach Wikipedia: re-run the load in the browser.
	$effect(() => {
		if (!data.article) invalidateAll();
	});
</script>

{#if data.article}
	{#key data.article.lang + ':' + data.article.title}
		<WikiPage article={data.article} />
	{/key}
{:else}
	<div class="wait"><span class="spinner"></span>Loading {data.title}…</div>
{/if}

<style>
	.wait {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		height: 100vh;
		color: var(--muted);
	}
	.spinner {
		width: 16px;
		height: 16px;
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
</style>
