// Overlay injected into the page while recording the how-to video:
// Clawd (pixel mascot) + speech bubble + pointer arrow + chapter chip +
// title cards + a visible mouse cursor. Everything is pointer-events: none.
(() => {
	if (window.clawd) return;
	const ORANGE = '#D97757';
	const U = 9; // pixel size

	const css = `
	#cw-root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; font-family: Inter, system-ui, sans-serif; }
	#cw-bot { position: absolute; left: 0; top: 0; width: ${14 * U}px; height: ${9 * U}px; transition: transform var(--walk, 1.2s) cubic-bezier(.45,.05,.35,1); will-change: transform; }
	#cw-bot .flip { width: 100%; height: 100%; transition: transform .25s; }
	#cw-bot.left .flip { transform: scaleX(-1); }
	#cw-bot .bob { width: 100%; height: 100%; animation: cw-bob 1.6s ease-in-out infinite; transform-origin: 50% 100%; }
	#cw-bot.walking .bob { animation: cw-walkbob .28s ease-in-out infinite; }
	#cw-bot.walking .legA { animation: cw-leg .28s steps(1) infinite; }
	#cw-bot.walking .legB { animation: cw-leg .28s steps(1) infinite .14s; }
	#cw-bot .eye { transform-box: fill-box; transform-origin: center; animation: cw-blink 4.2s infinite; }
	#cw-bot.jump .bob { animation: cw-jump .7s cubic-bezier(.3,1.6,.5,1); }
	#cw-bot.wave .armR { transform-box: fill-box; transform-origin: 0% 50%; animation: cw-wave .45s ease-in-out 4 alternate; }
	#cw-bot .shadow { position: absolute; left: 10%; right: 10%; bottom: -8px; height: 8px; border-radius: 50%; background: rgba(0,0,0,.18); filter: blur(2px); animation: cw-shadow 1.6s ease-in-out infinite; }
	@keyframes cw-bob { 50% { transform: translateY(-4px) scaleY(1.03); } }
	@keyframes cw-walkbob { 50% { transform: translateY(-5px) rotate(-2deg); } }
	@keyframes cw-leg { 0% { transform: translateY(0); } 50% { transform: translateY(-${U * 0.7}px); } }
	@keyframes cw-blink { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(.1); } }
	@keyframes cw-jump { 0% { transform: none; } 30% { transform: translateY(-46px) scaleY(1.08); } 60% { transform: translateY(0) scaleX(1.12) scaleY(.88); } 100% { transform: none; } }
	@keyframes cw-wave { from { transform: rotate(0deg); } to { transform: rotate(-35deg); } }
	@keyframes cw-shadow { 50% { transform: scaleX(.85); opacity: .7; } }

	#cw-bubble { position: absolute; width: max-content; max-width: 290px; padding: 12px 16px; border-radius: 16px; background: #fff; color: #1f1f1f; font-size: 16.5px; line-height: 1.42; font-weight: 500;
		box-shadow: 0 10px 40px rgba(0,0,0,.18), 0 0 0 2px ${ORANGE}; opacity: 0; transform: translateY(10px) scale(.92); transform-origin: 85% 100%;
		transition: opacity .25s, transform .35s cubic-bezier(.34,1.56,.64,1); }
	#cw-bubble.on { opacity: 1; transform: none; }
	#cw-bubble::after { content: ''; position: absolute; right: 44px; bottom: -11px; width: 20px; height: 20px; background: #fff; transform: rotate(45deg); box-shadow: 2px 2px 0 0 ${ORANGE}; }
	#cw-bubble b { color: ${ORANGE}; }
	#cw-bubble .caret { display: inline-block; width: 2px; height: 1em; margin-left: 2px; vertical-align: -2px; background: ${ORANGE}; animation: cw-caret .8s steps(2) infinite; }
	@keyframes cw-caret { 50% { opacity: 0; } }

	#cw-arrow { position: absolute; left: 0; top: 0; font-size: 54px; line-height: 1; color: ${ORANGE}; opacity: 0; transition: opacity .3s; filter: drop-shadow(0 4px 10px rgba(217,119,87,.45)); }
	#cw-arrow.on { opacity: 1; }
	#cw-arrow span { display: block; animation: cw-point .7s ease-in-out infinite alternate; }
	@keyframes cw-point { to { transform: translate(var(--dx), var(--dy)); } }
	#cw-ring { position: absolute; border: 3px solid ${ORANGE}; border-radius: 14px; opacity: 0; transition: opacity .3s, left .4s, top .4s, width .4s, height .4s; box-shadow: 0 0 0 6px rgba(217,119,87,.18); }
	#cw-ring.on { opacity: 1; animation: cw-ring 1.2s ease-in-out infinite; }
	@keyframes cw-ring { 50% { box-shadow: 0 0 0 12px rgba(217,119,87,.08); } }

	#cw-chapter { position: absolute; left: 50%; top: 68px; margin-left: -150px; display: flex; align-items: center; gap: 12px; padding: 10px 18px 10px 10px; border-radius: 999px; background: rgba(20,20,22,.88); color: #fff; font-size: 15px; font-weight: 600;
		opacity: 0; transform: translateY(-16px); transition: opacity .35s, transform .45s cubic-bezier(.22,1,.36,1); backdrop-filter: blur(8px); }
	#cw-chapter.on { opacity: 1; transform: none; }
	#cw-chapter i { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: ${ORANGE}; font-style: normal; font-size: 15px; }

	#cw-card { position: absolute; inset: 0; z-index: 5; display: grid; place-items: center; background: radial-gradient(1200px 700px at 50% 40%, #2a211d, #121012 70%); color: #fff; opacity: 0; transition: opacity .6s; text-align: center; }
	#cw-card.on { opacity: 1; }
	#cw-card h1 { margin: 22px 0 8px; font: 500 58px/1.05 'Source Serif 4', Georgia, serif; letter-spacing: -.02em; }
	#cw-card p { margin: 0; font-size: 21px; color: #d8cfc9; }
	#cw-card .url { margin-top: 26px; display: inline-block; padding: 12px 26px; border-radius: 999px; background: ${ORANGE}; color: #fff; font-size: 19px; font-weight: 600; }
	#cw-card .big { animation: cw-bob 1.6s ease-in-out infinite; }

	#cw-cursor { position: absolute; left: 0; top: 0; width: 26px; height: 26px; transform: translate(-100px,-100px); filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
	.cw-click { position: absolute; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; border: 3px solid ${ORANGE}; animation: cw-click .5s ease-out forwards; }
	@keyframes cw-click { to { transform: scale(3.2); opacity: 0; } }
	`;

	function botSvg(scale = 1) {
		const u = U * scale;
		const r = (x, y, w, h, cls = '', fill = ORANGE) => `<rect class="${cls}" x="${x * u}" y="${y * u}" width="${w * u}" height="${h * u}" fill="${fill}"/>`;
		return `<svg width="${14 * u}" height="${9 * u}" viewBox="0 0 ${14 * u} ${9 * u}" shape-rendering="crispEdges">
			<g class="legA">${r(3, 6, 1, 3)}${r(8, 6, 1, 3)}</g>
			<g class="legB">${r(5, 6, 1, 3)}${r(10, 6, 1, 3)}</g>
			${r(2, 0, 10, 6.2)}
			${r(0, 2, 2, 2, 'armL')}
			${r(12, 2, 2, 2, 'armR')}
			${r(4, 1.5, 1, 2, 'eye', '#1a1a1a')}${r(9, 1.5, 1, 2, 'eye', '#1a1a1a')}
		</svg>`;
	}

	function mount() {
		const style = document.createElement('style');
		style.textContent = css;
		document.head.append(style);
		const root = document.createElement('div');
		root.id = 'cw-root';
		root.innerHTML = `
			<div id="cw-card"></div>
			<div id="cw-ring"></div>
			<div id="cw-arrow"><span>⬇</span></div>
			<div id="cw-chapter"><i></i><span></span></div>
			<div id="cw-bubble"></div>
			<div id="cw-bot" style="transform: translate(-200px, 900px)"><div class="shadow"></div><div class="flip"><div class="bob">${botSvg()}</div></div></div>
			<svg id="cw-cursor" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1 3.8 7.2-2.6 1.3L9.9 15.4 5 20z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
		document.body.append(root);

		const $ = (id) => root.querySelector(id);
		const bot = $('#cw-bot');
		const bubble = $('#cw-bubble');
		const cursor = $('#cw-cursor');
		let pos = { x: -200, y: 900 };
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

		addEventListener('mousemove', (e) => (cursor.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 2}px)`), true);
		addEventListener(
			'mousedown',
			(e) => {
				const c = document.createElement('div');
				c.className = 'cw-click';
				c.style.left = e.clientX + 'px';
				c.style.top = e.clientY + 'px';
				root.append(c);
				setTimeout(() => c.remove(), 600);
			},
			true
		);

		// The bubble hangs up-and-left of Clawd so it never runs off the right edge.
		function placeBubble() {
			const h = bubble.offsetHeight;
			const w = bubble.offsetWidth;
			bubble.style.left = `${Math.max(12, pos.x + 14 * U - w + 6)}px`;
			bubble.style.top = `${pos.y - h - 22}px`;
		}

		let sayToken = 0;
		window.clawd = {
			place(x, y) {
				bot.style.transition = 'none';
				pos = { x, y };
				bot.style.transform = `translate(${x}px, ${y}px)`;
				void bot.offsetWidth;
				bot.style.transition = '';
			},
			async walkTo(x, y, ms) {
				const dist = Math.hypot(x - pos.x, y - pos.y);
				ms = ms ?? Math.max(500, dist * 2.2);
				bot.style.setProperty('--walk', `${ms}ms`);
				bubble.style.setProperty('--walk', `${ms}ms`);
				bot.classList.toggle('left', x < pos.x);
				bot.classList.add('walking');
				pos = { x, y };
				bot.style.transform = `translate(${x}px, ${y}px)`;
				placeBubble();
				await sleep(ms);
				bot.classList.remove('walking', 'left');
			},
			async say(html, hold = 1500) {
				const token = ++sayToken;
				const text = html;
				bubble.classList.add('on');
				// Typewriter: reveal characters while keeping <b> tags intact.
				const parts = text.split(/(<[^>]+>)/);
				let shown = '';
				bubble.innerHTML = '<span class="caret"></span>';
				placeBubble();
				for (const p of parts) {
					if (p.startsWith('<')) {
						shown += p;
						continue;
					}
					for (const ch of p) {
						if (token !== sayToken) return;
						shown += ch;
						bubble.innerHTML = shown + '<span class="caret"></span>';
						placeBubble();
						await sleep(ch === ' ' ? 18 : /[.,!?—]/.test(ch) ? 110 : 26);
					}
				}
				bubble.innerHTML = shown;
				placeBubble();
				await sleep(hold);
			},
			hush() {
				sayToken++;
				bubble.classList.remove('on');
			},
			async jump() {
				bot.classList.remove('jump');
				void bot.offsetWidth;
				bot.classList.add('jump');
				await sleep(700);
				bot.classList.remove('jump');
			},
			async wave() {
				bot.classList.add('wave');
				await sleep(1800);
				bot.classList.remove('wave');
			},
			/** Point at a screen rect (or element selector) with a bouncing arrow and a ring. */
			point(target, dir = 'down') {
				const r = typeof target === 'string' ? document.querySelector(target)?.getBoundingClientRect() : target;
				const arrow = $('#cw-arrow');
				const ring = $('#cw-ring');
				if (!r) return;
				const glyph = { down: '⬇', up: '⬆', left: '⬅', right: '➡' }[dir];
				const d = { down: ['0px', '12px'], up: ['0px', '-12px'], left: ['-12px', '0px'], right: ['12px', '0px'] }[dir];
				arrow.querySelector('span').textContent = glyph;
				arrow.style.setProperty('--dx', d[0]);
				arrow.style.setProperty('--dy', d[1]);
				const cx = r.left + r.width / 2 - 20;
				const cy = r.top + r.height / 2 - 28;
				const at = {
					down: [cx, r.top - 70],
					up: [cx, r.bottom + 12],
					left: [r.right + 14, cy],
					right: [r.left - 70, cy]
				}[dir];
				arrow.style.left = at[0] + 'px';
				arrow.style.top = at[1] + 'px';
				arrow.classList.add('on');
				Object.assign(ring.style, { left: r.left - 8 + 'px', top: r.top - 8 + 'px', width: r.width + 16 + 'px', height: r.height + 16 + 'px' });
				ring.classList.add('on');
			},
			unpoint() {
				$('#cw-arrow').classList.remove('on');
				$('#cw-ring').classList.remove('on');
			},
			chapter(n, label, top = 68) {
				const c = $('#cw-chapter');
				c.style.top = `${top}px`;
				c.classList.remove('on');
				setTimeout(() => {
					c.querySelector('i').textContent = n;
					c.querySelector('span').textContent = label;
					c.style.marginLeft = `${-c.offsetWidth / 2}px`;
					c.classList.add('on');
				}, label ? 250 : 0);
				if (!label) c.classList.remove('on');
			},
			card(html) {
				const card = $('#cw-card');
				if (!html) return card.classList.remove('on');
				card.innerHTML = `<div><div class="big">${botSvg(2.4)}</div>${html}</div>`;
				card.classList.add('on');
			}
		};
	}

	if (document.body) mount();
	else addEventListener('DOMContentLoaded', mount);
})();
