// Scripted how-to recording: drives the real app, captures CDP screencast
// frames (with timestamps) into ./frames, and writes frames.json.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const BASE = process.env.BASE ?? 'http://localhost:5173';
const W = 1280;
const H = 720;
const DSF = 1.5; // output is 1920×1080 but the UI reads 1.5× larger
const ARTICLE = '/wiki/Claude_(AI)';
const STAND = { x: 1280 - 126 - 40, y: 492 }; // Clawd's spot: bottom-right, above the dock
const PARK = { x: 900, y: 115 }; // where the cursor rests while things animate

const ctx = await chromium.launchPersistentContext(path.join(DIR, 'profile'), {
	executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
	viewport: { width: W, height: H },
	deviceScaleFactor: DSF,
	colorScheme: 'light',
	args: ['--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', '--force-color-profile=srgb', `--force-device-scale-factor=${DSF}`]
});
await ctx.addInitScript({ path: path.join(DIR, 'clawd.js') });
// Start every take with sound off, and mirror the site's sound cues for the soundtrack.
await ctx.addInitScript(() => {
	try {
		localStorage.setItem('tm-sfx', '0');
	} catch {}
	window.__cues = [];
	addEventListener('tm-sfx', (e) => window.__cues.push(e.detail));
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

const sleep = (ms) => page.waitForTimeout(ms);
// Timeline of on-screen events, used to sync sound effects to the picture.
const events = [];
const log = (type, extra = {}) => events.push({ t: Date.now() / 1000, type, ...extra });
const cw = (m, ...a) => {
	if (m === 'say') log('say', { text: String(a[0]).replace(/<[^>]+>/g, '') });
	else if (m === 'card') log(a[0] ? 'card-in' : 'card-out');
	else if (m === 'chapter' && a[1]) log('chapter');
	else if (m === 'jump' || m === 'wave') log(m);
	else if (m === 'walkTo') log('walk', { ms: a[2] ?? 1200 });
	return page.evaluate(([m, a]) => window.clawd[m](...a), [m, a]);
};
const tm = (code) => page.evaluate(`window.__tm.history.${code}`);
const settled = () =>
	page.waitForFunction(() => window.__tm?.history && !window.__tm.history.fetching && !window.__tm.history.loadingMeta, null, { timeout: 60000 });

let mouse = { x: W / 2, y: H / 2 };
async function moveTo(target, ms = 700) {
	let x, y;
	if (typeof target === 'string') {
		const b = await page.locator(target).first().boundingBox();
		x = b.x + b.width / 2;
		y = b.y + b.height / 2;
	} else ({ x, y } = target);
	const steps = Math.max(8, Math.round(ms / 16));
	const from = { ...mouse };
	for (let i = 1; i <= steps; i++) {
		const t = i / steps;
		const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
		await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
		await sleep(ms / steps);
	}
	mouse = { x, y };
}
async function click(target, ms) {
	await moveTo(target, ms);
	await sleep(120);
	log('click');
	await page.mouse.down();
	await sleep(70);
	await page.mouse.up();
}

// ─── warm-up pass: fill the HTTP cache so the recording never stalls ─────
async function warm() {
	await page.goto(BASE + '/', { waitUntil: 'networkidle' });
	await page.goto(BASE + ARTICLE + '?view=history', { waitUntil: 'networkidle' });
	await settled();
	for (const i of [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 139, 140, 144, 145, 549, 550, 821, 822]) {
		await tm(`seek(${i})`);
		await settled();
	}
	await page.goto(BASE + ARTICLE + '?view=history&source=talk', { waitUntil: 'networkidle' });
	await settled();
	await tm('seek(3)');
	await settled();
}

// ─── screencast capture ────────────────────────────────────────────────
const frames = [];
let cdp;
async function startCapture() {
	fs.rmSync(path.join(DIR, 'frames'), { recursive: true, force: true });
	fs.mkdirSync(path.join(DIR, 'frames'));
	cdp = await ctx.newCDPSession(page);
	cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
		const file = `f${String(frames.length).padStart(6, '0')}.jpg`;
		fs.writeFileSync(path.join(DIR, 'frames', file), Buffer.from(data, 'base64'));
		frames.push({ file, t: metadata.timestamp });
		cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
	});
	await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W * DSF, maxHeight: H * DSF, everyNthFrame: 1 });
}
async function stopCapture() {
	await cdp.send('Page.stopScreencast');
	fs.writeFileSync(path.join(DIR, 'frames.json'), JSON.stringify(frames));
	fs.writeFileSync(path.join(DIR, 'events.json'), JSON.stringify(events));
	const cues = await page.evaluate(() => window.__cues ?? []);
	fs.writeFileSync(path.join(DIR, 'sfx.json'), JSON.stringify(cues.map((c) => ({ kind: c.kind, t: c.at / 1000 }))));
}

// A tiny heartbeat element forces a repaint every frame, so the screencast
// keeps a steady cadence even when nothing else moves.
async function heartbeat() {
	await page.evaluate(() => {
		if (document.getElementById('cw-hb')) return;
		const d = document.createElement('div');
		d.id = 'cw-hb';
		Object.assign(d.style, { position: 'fixed', right: '0', bottom: '0', width: '1px', height: '1px', opacity: '0.01', zIndex: '2147483647', pointerEvents: 'none' });
		document.body.append(d);
		let n = 0;
		const tick = () => {
			d.style.background = n++ % 2 ? '#fff' : '#fefefe';
			requestAnimationFrame(tick);
		};
		tick();
	});
}

// ─── the film (short cut, ~1 min) ───────────────────────────────────────
// Clawd talks *while* things happen (sayBg) instead of before them.
const sayBg = (text) => {
	log('say', { text: text.replace(/<[^>]+>/g, '') });
	page.evaluate((t) => window.clawd.say(t, 0), text).catch(() => {});
};

async function film() {
	await page.goto(BASE + '/', { waitUntil: 'networkidle' });
	await heartbeat();
	await cw('card', `<h1>Wiki Time Machine</h1><p>Watch any Wikipedia article write itself</p>`);
	await sleep(600);
	await startCapture();
	const t0 = Date.now();
	const mark = (label) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6), label);
	const bg = (m, ...a) => {
		log(m);
		page.evaluate(([m, a]) => window.clawd[m](...a), [m, a]).catch(() => {});
	};

	// Intro (~3s)
	mark('intro');
	await sleep(1500);
	await cw('card', '');
	await cw('place', W + 20, STAND.y);
	await cw('walkTo', STAND.x, STAND.y, 850);
	bg('wave');
	sayBg(`Hi, I'm <b>Clawd</b>! Let's time-travel through <b>Claude</b>'s article.`);

	// 1 · Search (~3s)
	mark('search');
	await cw('chapter', '1', 'Search any article', 14);
	await click('.search input', 450);
	await page.keyboard.type('Claude (AI)', { delay: 38 });
	await page.waitForSelector('.hits button', { timeout: 15000 });
	await sleep(200);
	const hit = page.locator('.hits button', { hasText: 'Claude (AI)' }).first();
	await click((await hit.count()) ? '.hits button:has-text("Claude (AI)")' : '.hits button', 380);
	await page.waitForURL('**/wiki/**');
	await page.waitForSelector('.wk-host.ready', { timeout: 30000 });
	await heartbeat();

	// 2 · Timeline (~2.3s)
	mark('timeline');
	await cw('chapter', '2', 'Every edit on one timeline');
	sayBg(`All <b>1,140 edits</b> live down here.`);
	const tl = await page.locator('.timeline canvas').boundingBox();
	await moveTo({ x: tl.x + tl.width * 0.15, y: tl.y + 34 }, 420);
	await moveTo({ x: tl.x + tl.width * 0.6, y: tl.y + 34 }, 1500);

	// 3 · Play (~4.5s)
	mark('play');
	await cw('chapter', '3', 'Press play');
	await click('.tabs button:nth-child(2)', 380);
	await settled();
	await tm('setSpeed(2)');
	sayBg(`Sound <b>on</b>, then press play!`);
	await cw('point', '.dock .sound', 'up');
	await click('.dock .sound', 420);
	await sleep(250);
	await cw('unpoint');
	await click('.cta', 420);
	await moveTo(PARK, 300);
	await sleep(2900);

	// 4 · Effects (~8s)
	mark('effects');
	await cw('chapter', '4', 'Every change animates');
	await tm('pause()');
	await tm('setSpeed(1)');
	await tm('seek(549)');
	await settled();
	sayBg(`Typos get <b>fixed</b>…`);
	log('step');
	await page.keyboard.press('ArrowRight');
	await sleep(2500);

	await tm('seek(144)');
	await settled();
	sayBg(`…images <b>flip</b>…`);
	log('step');
	await page.keyboard.press('ArrowRight');
	await sleep(1900);

	await tm('seek(821)');
	await settled();
	sayBg(`…or <b>shatter</b>!`);
	log('step');
	await page.keyboard.press('ArrowRight');
	await sleep(700);
	bg('jump');
	await sleep(1500);

	// 5 · Fast forward (~3s)
	mark('fast');
	await cw('chapter', '5', 'Fly through the years');
	await tm('setSpeed(32)');
	await page.selectOption('.dock select', 'month');
	await tm('seek(-1)');
	await settled();
	sayBg(`Or zoom through <b>years</b> in seconds.`);
	await click('.play', 380);
	await moveTo(PARK, 300);
	await sleep(2300);
	await tm('pause()');

	// 6 · Talk page (~2.5s)
	mark('talk');
	await cw('chapter', '6', 'Replay the talk page');
	await click('.seg.source button:nth-child(2)', 420);
	await page.waitForFunction(() => window.__tm.history.title.startsWith('Talk:'));
	await settled();
	await tm('setSpeed(4)');
	sayBg(`Even the <b>Talk</b> page replays!`);
	await tm('play()');
	await sleep(2000);

	// Outro (~2.8s)
	mark('outro');
	await cw('chapter', '', '');
	await cw('hush');
	await cw('card', `<h1>Wiki Time Machine</h1><p>Every Wikipedia article, edit by edit.</p><div class="url">timemachine.carbonadoks.com</div>`);
	await sleep(2800);
	mark('end');
	await stopCapture();
}

if (!process.argv.includes('--no-warm')) {
	console.log('warming cache…');
	await warm();
}
console.log('recording…');
await film();
console.log(`captured ${frames.length} frames over ${(frames.at(-1).t - frames[0].t).toFixed(1)}s`);
await ctx.close();
