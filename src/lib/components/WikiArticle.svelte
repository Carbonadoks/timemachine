<script module lang="ts">
	// Wikipedia's own content styles (skin, site CSS, cite, math, collapsibles),
	// fetched once per language and rewritten so they only apply inside our
	// shadow root: `html`/`body`/`:root` become wrapper classes and relative
	// url()s become absolute.
	const MODULES = [
		'site.styles',
		'skins.vector.styles',
		'ext.cite.styles',
		'ext.math.styles',
		'ext.pygments',
		'jquery.makeCollapsible.styles',
		'mediawiki.page.gallery.styles',
		'ext.tmh.player.styles',
		'wikibase.client.init'
	].join('|');

	const cssCache = new Map<string, Promise<string>>();

	export function scopeCss(css: string, lang: string) {
		return css
			.replace(/:root\b/g, '.wk-html')
			.replace(/(^|[{},\s>+~(])html(?=[\s.,:#>{[)])/g, '$1.wk-html')
			.replace(/(^|[{},\s>+~(])body(?=[\s.,:#>{[)])/g, '$1.wk-body')
			.replace(/url\((['"]?)\/\//g, 'url($1https://')
			.replace(/url\((['"]?)\/(?!\/)/g, `url($1https://${lang}.wikipedia.org/`);
	}

	function loadCss(lang: string) {
		let p = cssCache.get(lang);
		if (!p) {
			const url = `https://${lang}.wikipedia.org/w/load.php?lang=${lang}&modules=${encodeURIComponent(MODULES)}&only=styles&skin=vector-2022`;
			p = fetch(url)
				.then((r) => (r.ok ? r.text() : ''))
				.then((css) => scopeCss(css, lang))
				.catch(() => '');
			cssCache.set(lang, p);
		}
		return p;
	}

	const OVERRIDES = `
		:host { display: block; }
		.wk-html, .wk-body { background: transparent !important; }
		.wk-body { margin: 0; color: var(--color-base, #202122); }
		.vector-body { font-size: var(--font-size-medium, 1rem); line-height: 1.6; }
		.mw-parser-output { overflow-wrap: break-word; }
		.mw-parser-output > .mw-heading:first-child h2 { margin-top: 0; }
		.mw-collapsible-toggle { cursor: pointer; user-select: none; }
		.wk-flash { animation: wk-flash 1.6s ease-out; }
		@keyframes wk-flash { from { background: rgba(250, 204, 21, .45); } to { background: transparent; } }
		@media (prefers-color-scheme: dark) {
			/* Site CSS hardcodes black text on these boxes. */
			.infobox, .navbox, .vertical-navbox, .sidebar, .wikitable, .quotebox, .toccolours, .ambox, .metadata {
				color: var(--color-base) !important;
			}
			/* Cells with a hard-coded light background need dark text to stay legible. */
			.mw-parser-output [style*='background']:not([style*='color']):not([style*='transparent']):not([style*='none']):not([style*='inherit']) { color: #202122; }
			.mw-parser-output [style*='background']:not([style*='color']):not([style*='transparent']):not([style*='none']):not([style*='inherit']) a:not(.new) { color: #3366cc !important; }
		}
		@media (max-width: 720px) {
			.infobox, figure, .thumb, table.sidebar { float: none !important; margin: 1em auto !important; }
		}
	`;

	/** Minimal re-implementation of MediaWiki's jquery.makeCollapsible. */
	function makeCollapsible(root: ParentNode) {
		for (const el of root.querySelectorAll<HTMLElement>('.mw-collapsible')) {
			const own = (n: Element) => n.closest('.mw-collapsible') === el;
			let targets: HTMLElement[];
			let host: HTMLElement;
			if (el.tagName === 'TABLE') {
				const rows = [...el.querySelectorAll<HTMLElement>(':scope > tbody > tr, :scope > thead > tr, :scope > tr')];
				targets = rows.slice(1);
				host = rows[0]?.querySelector<HTMLElement>('th:last-child, td:last-child') ?? el;
			} else {
				const contents = [...el.querySelectorAll<HTMLElement>('.mw-collapsible-content')].filter(own);
				targets = contents.length
					? contents
					: ([...el.children] as HTMLElement[]).filter((c) => !c.classList.contains('mw-collapsible-toggle-placeholder')).slice(el.tagName === 'UL' || el.tagName === 'OL' ? 0 : 1);
				host = el.querySelector<HTMLElement>('.mw-collapsible-toggle-placeholder') ?? el;
			}
			el.classList.add('mw-made-collapsible');
			const toggle = document.createElement('span');
			toggle.className = 'mw-collapsible-toggle mw-collapsible-toggle-default';
			toggle.setAttribute('role', 'button');
			toggle.tabIndex = 0;
			const link = document.createElement('a');
			toggle.append('[', link, ']');
			host.prepend(toggle);
			let collapsed = el.classList.contains('mw-collapsed');
			const apply = () => {
				for (const t of targets) t.style.display = collapsed ? 'none' : '';
				link.textContent = collapsed ? 'show' : 'hide';
				el.classList.toggle('mw-collapsed', collapsed);
			};
			toggle.addEventListener('click', (e) => {
				e.preventDefault();
				collapsed = !collapsed;
				apply();
			});
			apply();
		}
	}
</script>

<script lang="ts">
	let { html, lang }: { html: string; lang: string } = $props();

	let hostEl: HTMLDivElement;
	let ready = $state(false);

	$effect(() => {
		const shadow = hostEl.shadowRoot ?? hostEl.attachShadow({ mode: 'open' });
		let alive = true;
		ready = false;
		// TemplateStyles blocks inside the article need the same scoping.
		const body = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/g, (_m, a, css, b) => a + scopeCss(css, lang) + b);
		loadCss(lang).then((css) => {
			if (!alive) return;
			shadow.innerHTML = `<style>${css}</style><style>${OVERRIDES}</style>
				<div class="wk-html client-js skin-theme-clientpref-os vector-feature-night-mode-enabled">
					<div class="wk-body skin-vector skin-vector-2022 mediawiki ltr sitedir-ltr ns-0">
						<div class="mw-body-content vector-body">
							<div id="mw-content-text" class="mw-body-content mw-content-ltr" lang="${lang}" dir="ltr">${body}</div>
						</div>
					</div>
				</div>`;
			makeCollapsible(shadow);
			ready = true;
		});
		return () => {
			alive = false;
		};
	});

	// In-page anchors (footnotes, section links) live inside the shadow root,
	// where the browser's own fragment navigation cannot see them.
	function onclick(e: MouseEvent) {
		const a = (e.composedPath() as HTMLElement[]).find((n) => n instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined;
		const href = a?.getAttribute('href');
		if (!href?.startsWith('#')) return;
		const target = hostEl.shadowRoot?.getElementById(decodeURIComponent(href.slice(1)));
		if (!target) return;
		e.preventDefault();
		target.scrollIntoView({ behavior: 'smooth', block: 'center' });
		target.classList.remove('wk-flash');
		void target.offsetWidth;
		target.classList.add('wk-flash');
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="wk-host" class:ready bind:this={hostEl} {onclick}></div>
{#if !ready}
	<div class="skeleton" aria-hidden="true">
		{#each [92, 100, 97, 60, 0, 100, 95, 98, 72] as w, i (i)}<span style:width="{w}%"></span>{/each}
	</div>
{/if}

<style>
	.wk-host {
		opacity: 0;
		transition: opacity 0.25s;
	}
	.wk-host.ready {
		opacity: 1;
	}
	.skeleton {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 720px;
	}
	.skeleton span {
		height: 14px;
		border-radius: 7px;
		background: var(--chip);
		animation: shimmer 1.2s ease-in-out infinite alternate;
	}
	@keyframes shimmer {
		to {
			opacity: 0.5;
		}
	}
</style>
