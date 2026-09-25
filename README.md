# Wiki Time Machine

A SvelteKit (Svelte 5) wrapper around Wikipedia. It shows the live article and loads
the article's **entire edit history** with edit summaries, so you can replay how the
text grew from its first draft to today as one continuous animation.

- **Article tab**: the current article, rendered from the MediaWiki parse API inside a Shadow DOM with Wikipedia's own stylesheets (infoboxes, navboxes, collapsible lists, night mode). Internal links stay inside the wrapper.
- **Time machine tab**: a replay of the history. Each edit animates in place:
  - *typo fixes*: the word wobbles, wrong letters get flung off spinning, moved letters leap-frog to their new spot, correct letters drop in with a squash-and-stretch, then a sparkle burst
  - *deletions*: a strike line draws across, then the letters crumble and fall while the gap closes
  - *insertions*: the text opens up and pushes its neighbours aside, then the new letters rain in
  - *new or removed paragraphs*: they grow open or shred and collapse
  - *images* (inline files, infobox images, galleries): new ones tumble in and "develop" like an instant photo, replaced ones flip over like a card, removed ones shatter into falling tiles
  - *wiki links* show up as links. When someone links existing words, the words turn blue, an underline sweeps across and a chain link clicks shut. When a link is removed, it flushes red and a broken chain drops away. Click a link to pause and open that article's time machine at the same date
  - *infobox fields* appear as a fact column beside the text, and their values animate like any other text
  - an edit cursor labelled with the editor's name glides to each change, and the camera follows
- **Timeline** (bottom): every revision as a +/- byte bar. Hover shows the editor and summary, click or drag to jump. Speed goes from 0.5× to 32×. The Daily/Monthly/Yearly steps make long histories watchable.

- **Article / Talk switch**: replays the article's talk page history with the same engine; discussion threads keep their indentation.

Shortcuts: `space` play/pause, `←/→` step one edit. `?view=history` opens the time machine directly, `&source=talk` starts on the talk page, `&at=2024-03-05T22:42:30Z` opens it on the version from that moment.

## Develop

    npm install
    npm run dev

## Deploy to Cloudflare Pages

Uses `@sveltejs/adapter-cloudflare`; the build output is `.svelte-kit/cloudflare`.

    npm run deploy        # build + wrangler pages deploy
    npm run preview:cf    # run the production build locally in workerd

Or connect the repo in the Cloudflare dashboard with build command `npm run build`
and output directory `.svelte-kit/cloudflare`.

Only the article HTML is fetched server-side, so pages get SSR. If Wikipedia rate-limits
the worker, the page falls back to loading in the browser. All revision data is fetched
directly from the browser (the Wikipedia API allows CORS), which keeps the worker well
within its CPU and subrequest limits.

## Code map

| File | Role |
| --- | --- |
| `src/lib/wiki.ts` | MediaWiki API client (article, streamed revision list, batched revision content) |
| `src/lib/wikitext.ts` | Lossy wikitext → readable paragraphs/headings/list items |
| `src/lib/links.ts` | Wiki link markers → per-block link ranges, and rendering them as `<a>` |
| `src/lib/diff.ts` | Myers diff, block pairing, word diff, typo detection |
| `src/lib/animator.ts` | Imperative Web Animations engine (`Stage`) |
| `src/lib/history.svelte.ts` | Playback controller: caching, prefetch, seek/play/step |
| `src/lib/components/*` | Search, timeline canvas, player, article page |
