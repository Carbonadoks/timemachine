// Tiny synthesised sound-effects kit for the time machine (Web Audio, no
// assets). Off by default; the dock's speaker button turns it on, which also
// satisfies the browser's "user gesture before audio" rule.

export type SfxKind = 'type' | 'pop' | 'strike' | 'crumble' | 'wobble' | 'sparkle' | 'photo' | 'flip' | 'shatter' | 'on';

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];
const KEY = 'tm-sfx';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let enabled = false;
const lastAt: Partial<Record<SfxKind, number>> = {};
// Minimum spacing per kind so dense animations don't turn into a buzz.
const GAP: Partial<Record<SfxKind, number>> = { type: 0.045, pop: 0.06, strike: 0.09, crumble: 0.12 };

try {
	enabled = localStorage.getItem(KEY) === '1';
} catch {
	/* storage unavailable */
}

function audio() {
	if (!ctx) {
		ctx = new AudioContext();
		master = ctx.createGain();
		master.gain.value = 0.55;
		const comp = ctx.createDynamicsCompressor();
		master.connect(comp).connect(ctx.destination);
		noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
		const d = noiseBuf.getChannelData(0);
		for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
	}
	if (ctx.state === 'suspended') ctx.resume();
	return ctx;
}

const hz = (semi: number, base = 523.25) => base * 2 ** (semi / 12);

function osc(type: OscillatorType, f0: number, f1: number, t: number, len: number, vol: number) {
	const c = ctx!;
	const o = c.createOscillator();
	const g = c.createGain();
	o.type = type;
	o.frequency.setValueAtTime(f0, t);
	o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + len);
	g.gain.setValueAtTime(0.0001, t);
	g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
	g.gain.exponentialRampToValueAtTime(0.0001, t + len);
	o.connect(g).connect(master!);
	o.start(t);
	o.stop(t + len + 0.02);
}

function noise(t: number, len: number, vol: number, filter: BiquadFilterType, f0: number, f1 = f0, q = 1) {
	const c = ctx!;
	const s = c.createBufferSource();
	s.buffer = noiseBuf;
	const bq = c.createBiquadFilter();
	bq.type = filter;
	bq.Q.value = q;
	bq.frequency.setValueAtTime(f0, t);
	bq.frequency.exponentialRampToValueAtTime(f1, t + len);
	const g = c.createGain();
	g.gain.setValueAtTime(0.0001, t);
	g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
	g.gain.exponentialRampToValueAtTime(0.0001, t + len);
	s.connect(bq).connect(g).connect(master!);
	s.start(t, Math.random() * 0.5);
	s.stop(t + len + 0.02);
}

const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export const sfx = {
	get enabled() {
		return enabled;
	},

	setEnabled(on: boolean) {
		enabled = on;
		try {
			localStorage.setItem(KEY, on ? '1' : '0');
		} catch {
			/* ignore */
		}
		if (on) sfx.play('on');
	},

	/** Schedule a sound `delayMs` from now (real milliseconds). */
	play(kind: SfxKind, delayMs = 0) {
		if (!enabled || typeof window === 'undefined') return;
		const c = audio();
		const t = c.currentTime + Math.max(0, delayMs) / 1000;
		const gap = GAP[kind];
		if (gap && lastAt[kind] !== undefined && Math.abs(t - lastAt[kind]!) < gap) return;
		lastAt[kind] = t;
		// Lets scripted recorders mirror the exact cue sheet.
		window.dispatchEvent(new CustomEvent('tm-sfx', { detail: { kind, at: Date.now() + delayMs } }));

		switch (kind) {
			case 'type':
				osc('square', hz(pick(PENTA) + 12), hz(pick(PENTA) + 12), t, 0.045, 0.035);
				break;
			case 'pop':
				osc('sine', 700, 260, t, 0.09, 0.18);
				break;
			case 'strike':
				noise(t, 0.16, 0.12, 'bandpass', 800, 5000, 4);
				break;
			case 'crumble':
				for (let i = 0; i < 5; i++) noise(t + i * 0.035 + Math.random() * 0.02, 0.04, 0.09, 'bandpass', 1500 + Math.random() * 2500, 900, 6);
				break;
			case 'wobble': {
				const o = c.createOscillator();
				const g = c.createGain();
				const lfo = c.createOscillator();
				const lg = c.createGain();
				o.type = 'triangle';
				o.frequency.setValueAtTime(260, t);
				o.frequency.exponentialRampToValueAtTime(520, t + 0.35);
				lfo.frequency.value = 18;
				lg.gain.value = 40;
				lfo.connect(lg).connect(o.frequency);
				g.gain.setValueAtTime(0.0001, t);
				g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
				g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
				o.connect(g).connect(master!);
				o.start(t);
				lfo.start(t);
				o.stop(t + 0.42);
				lfo.stop(t + 0.42);
				break;
			}
			case 'sparkle':
				[0, 4, 7, 12].forEach((s, i) => osc('sine', hz(s + 12), hz(s + 12), t + i * 0.055, 0.32, 0.09));
				break;
			case 'photo':
				noise(t, 0.035, 0.25, 'highpass', 3000);
				noise(t + 0.07, 0.05, 0.18, 'highpass', 2000);
				[0, 7, 12].forEach((s, i) => osc('sine', hz(s), hz(s), t + 0.15 + i * 0.07, 0.4, 0.07));
				break;
			case 'flip':
				noise(t, 0.35, 0.16, 'bandpass', 400, 3000, 1.5);
				osc('sine', 300, 900, t + 0.1, 0.25, 0.05);
				break;
			case 'shatter':
				noise(t, 0.5, 0.3, 'highpass', 2500, 6000);
				for (let i = 0; i < 12; i++) osc('sine', 2500 + Math.random() * 3500, 2000 + Math.random() * 3000, t + Math.random() * 0.35, 0.12, 0.05);
				osc('sine', 120, 50, t, 0.25, 0.25);
				break;
			case 'on':
				osc('sine', hz(0), hz(0), t, 0.18, 0.12);
				osc('sine', hz(7), hz(7), t + 0.09, 0.28, 0.12);
				break;
		}
	}
};
