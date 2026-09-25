"""Original soundtrack for the how-to video: an upbeat chiptune-lofi loop
(I–V–vi–IV in C at 108 BPM) plus sound effects synced to events.json.

usage: python3 music.py <duration_seconds> <frames.json> <events.json> <out.wav>
"""
import json
import sys

import numpy as np
from scipy import signal

SR = 44100
BPM = 108
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(7)

dur = float(sys.argv[1])
t0 = json.load(open(sys.argv[2]))[0]['t']
events = [dict(e, t=e['t'] - t0) for e in json.load(open(sys.argv[3]))]
cues = [dict(c, t=c['t'] - t0) for c in json.load(open(sys.argv[5]))] if len(sys.argv) > 5 else []
N = int((dur + 1) * SR)
L = np.zeros(N)
R = np.zeros(N)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def env(n, a=0.005, d=0.1, s=0.6, r=0.1, hold=None):
    """ADSR envelope over n samples (hold = sustain length in samples)."""
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    hold = max(0, n - a_n - d_n - r_n) if hold is None else hold
    e = np.concatenate([
        np.linspace(0, 1, max(a_n, 1)),
        np.linspace(1, s, max(d_n, 1)),
        np.full(hold, s),
        np.linspace(s, 0, max(r_n, 1)),
    ])
    return e[:n] if len(e) >= n else np.pad(e, (0, n - len(e)))


def lowpass(x, hz, order=2):
    b, a = signal.butter(order, hz / (SR / 2), 'low')
    return signal.lfilter(b, a, x)


def highpass(x, hz, order=2):
    b, a = signal.butter(order, hz / (SR / 2), 'high')
    return signal.lfilter(b, a, x)


def add(buf_l, buf_r, start, x, gain=1.0, pan=0.0):
    i = int(start * SR)
    if i >= N or i + len(x) <= 0:
        return
    x = x[: N - i] * gain
    buf_l[i:i + len(x)] += x * np.sqrt(0.5 * (1 - pan))
    buf_r[i:i + len(x)] += x * np.sqrt(0.5 * (1 + pan))


def tone(freq, length, kind='tri', duty=0.5):
    t = np.arange(int(length * SR)) / SR
    ph = 2 * np.pi * freq * t
    if kind == 'tri':
        return signal.sawtooth(ph, 0.5)
    if kind == 'square':
        return signal.square(ph, duty)
    if kind == 'saw':
        return signal.sawtooth(ph)
    return np.sin(ph)


# ─── arrangement ──────────────────────────────────────────────────────────
CHORDS = [(60, 64, 67), (55, 59, 62), (57, 60, 64), (53, 57, 60)]  # C G Am F
MELODY = [
    [76, None, 79, None, 84, 83, 79, None],
    [74, None, 79, None, 83, None, 81, 79],
    [76, None, 81, None, 84, 83, 81, None],
    [77, 76, 74, None, 72, None, 74, None],
]
MELODY_B = [
    [72, 74, 76, None, 79, None, 76, None],
    [74, None, 71, None, 74, 76, 74, None],
    [72, None, 76, None, 81, None, 79, 76],
    [77, None, 76, None, 74, 72, 74, None],
]
bars = int(dur / BAR) + 2
outro_start = dur - 4.5

pad_l, pad_r = np.zeros(N), np.zeros(N)
kick_env = np.zeros(N)

for b in range(bars):
    start = b * BAR
    if start > dur:
        break
    chord = CHORDS[b % 4]
    intro = start < 4.0            # title card: pad + arp only
    outro = start >= outro_start
    # pad: detuned saws, low-passed, long attack
    for n in chord:
        for det in (-0.07, 0.07):
            x = tone(midi(n + det), BAR, 'saw')
            x = lowpass(x, 1100) * env(len(x), a=0.35, d=0.4, s=0.7, r=0.5)
            add(pad_l, pad_r, start, x, 0.045, pan=det * 6)
    # arpeggio: 16th notes, soft pulse wave
    arp_notes = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 12]
    for k in range(16):
        n = arp_notes[k % 4] + (12 if k % 8 == 6 else 0)
        x = tone(midi(n), BEAT / 4, 'square', 0.25)
        x = lowpass(x, 2600) * env(len(x), a=0.002, d=0.08, s=0.15, r=0.02)
        add(L, R, start + k * BEAT / 4, x, 0.028 if not intro else 0.02, pan=-0.35)
    if intro:
        continue
    # bass: root 8ths with octave hops
    for k in range(8):
        n = chord[0] - 24 + (12 if k in (3, 7) else 0)
        x = tone(midi(n), BEAT / 2 * 0.9, 'tri')
        x = x * env(len(x), a=0.004, d=0.12, s=0.5, r=0.03)
        add(L, R, start + k * BEAT / 2, x, 0.16 if not outro else 0.08)
    if outro:
        continue
    # drums
    for beat in range(4):
        bt = start + beat * BEAT
        if beat in (0, 2) or (beat == 3 and b % 2):
            n = int(0.28 * SR)
            tt = np.arange(n) / SR
            f = 45 + 95 * np.exp(-tt * 28)
            x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 13)
            at = bt + (BEAT / 2 if beat == 3 else 0)
            add(L, R, at, x, 0.42)
            i = int(at * SR)
            kick_env[i:i + int(0.25 * SR)] = np.maximum(kick_env[i:i + int(0.25 * SR)], np.exp(-np.arange(min(int(0.25 * SR), N - i)) / SR * 9))
        if beat in (1, 3):
            n = int(0.2 * SR)
            tt = np.arange(n) / SR
            noise = highpass(rng.standard_normal(n), 1800) * np.exp(-tt * 22)
            body = np.sin(2 * np.pi * 185 * tt) * np.exp(-tt * 30)
            add(L, R, bt, noise * 0.5 + body * 0.6, 0.16, pan=0.1)
        for h in range(2):
            n = int(0.045 * SR)
            x = highpass(rng.standard_normal(n), 7000) * np.exp(-np.arange(n) / SR * 90)
            add(L, R, bt + h * BEAT / 2, x, 0.05 if h else 0.03, pan=0.4)
    # lead melody on alternating 4-bar phrases (A then B), after the intro
    phrase = MELODY if (b // 4) % 2 == 0 else MELODY_B
    if (b // 4) % 3 == 2:
        continue  # breathe: every third phrase has no lead
    slots = phrase[b % 4]
    for k, n in enumerate(slots):
        if n is None:
            continue
        length = BEAT / 2
        j = k + 1
        while j < 8 and slots[j] is None:
            length += BEAT / 2
            j += 1
        tt = np.arange(int(length * SR)) / SR
        vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * tt) * np.clip(tt * 4, 0, 1)
        ph = 2 * np.pi * np.cumsum(midi(n) * vib) / SR
        x = 0.6 * signal.sawtooth(ph, 0.5) + 0.4 * signal.square(ph, 0.5)
        x = lowpass(x, 3200) * env(len(x), a=0.01, d=0.15, s=0.55, r=0.08)
        add(L, R, start + k * BEAT / 2, x, 0.07, pan=0.25)

# sidechain-style pump on the pad
duck = 1 - 0.45 * kick_env
L += pad_l * duck
R += pad_r * duck

# ─── sound effects synced to the picture ─────────────────────────────────
PENTA = [72, 74, 76, 79, 81, 84]
sfx_l, sfx_r = np.zeros(N), np.zeros(N)


def blip(at, n, gain=0.05):
    x = tone(midi(n), 0.05, 'square', 0.5)
    x = lowpass(x, 4000) * np.exp(-np.arange(len(x)) / SR * 60)
    add(sfx_l, sfx_r, at, x, gain)


for e in events:
    t = e['t']
    if t < -0.5:
        continue
    kind = e['type']
    if kind == 'say':
        # mirror clawd.say()'s typewriter cadence; blip every other letter
        at = t + 0.04
        for idx, ch in enumerate(e['text']):
            if ch.isalnum() and idx % 2 == 0:
                blip(at, PENTA[rng.integers(len(PENTA))] + 12, 0.012)
            at += 0.018 if ch == ' ' else 0.110 if ch in '.,!?—' else 0.026
            at += 0.004  # evaluate round-trips make the page slightly slower than nominal
    elif kind == 'click':
        n = int(0.06 * SR)
        tt = np.arange(n) / SR
        x = np.sin(2 * np.pi * (900 - 5000 * tt) * tt) * np.exp(-tt * 70)
        add(sfx_l, sfx_r, t + 0.19, x, 0.12)
    elif kind in ('card-in', 'card-out'):
        n = int(0.9 * SR)
        tt = np.arange(n) / SR
        noise = rng.standard_normal(n)
        sweep = np.linspace(400, 5000, n) if kind == 'card-out' else np.linspace(5000, 400, n)
        b, a = signal.butter(2, [300 / (SR / 2), 6000 / (SR / 2)], 'band')
        x = signal.lfilter(b, a, noise) * np.sin(np.pi * tt / tt[-1]) ** 2
        x = x * (0.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(sweep) / SR / 40))
        add(sfx_l, sfx_r, max(t, 0), x, 0.07)
    elif kind == 'chapter':
        for k, n in enumerate((79, 84, 88)):
            x = tone(midi(n), 0.35, 'sine') * np.exp(-np.arange(int(0.35 * SR)) / SR * 9)
            add(sfx_l, sfx_r, t + 0.25 + k * 0.07, x, 0.07, pan=(k - 1) * 0.4)
    elif kind in ('jump', 'wave'):
        n = int(0.3 * SR)
        tt = np.arange(n) / SR
        f = 300 + 900 * tt / tt[-1] if kind == 'jump' else 600 + 120 * np.sin(2 * np.pi * 9 * tt)
        x = signal.square(2 * np.pi * np.cumsum(f) / SR, 0.5) * np.exp(-tt * 7)
        add(sfx_l, sfx_r, t, lowpass(x, 3000), 0.045)
    elif kind == 'walk':
        steps = int(e['ms'] / 140)
        for k in range(steps):
            n = int(0.03 * SR)
            x = lowpass(rng.standard_normal(n), 900) * np.exp(-np.arange(n) / SR * 120)
            add(sfx_l, sfx_r, t + k * 0.14, x, 0.12, pan=0.3 if k % 2 else -0.3)
    elif kind == 'step':
        # a soft riser into each showcased effect
        n = int(0.5 * SR)
        tt = np.arange(n) / SR
        x = np.sin(2 * np.pi * np.cumsum(300 + 700 * (tt / tt[-1]) ** 2) / SR) * (tt / tt[-1]) * np.exp(-(tt - tt[-1]) ** 2 * 0)
        add(sfx_l, sfx_r, t - 0.1, lowpass(x, 2500), 0.035)

# ─── the site's own sound effects, mirrored from its cue sheet ───────────
def bandnoise(length, lo, hi):
    n = int(length * SR)
    b, a = signal.butter(2, [lo / (SR / 2), min(hi, SR / 2 - 100) / (SR / 2)], 'band')
    return signal.lfilter(b, a, rng.standard_normal(n))


def expenv(length, rate):
    return np.exp(-np.arange(int(length * SR)) / SR * rate)


def sweep_tone(f0, f1, length, kind='sine'):
    n = int(length * SR)
    f = f0 * (f1 / f0) ** (np.arange(n) / n)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return {'sine': np.sin(ph), 'tri': signal.sawtooth(ph, 0.5), 'square': signal.square(ph)}[kind]


def hz(semi):
    return 523.25 * 2 ** (semi / 12)


for c in cues:
    t, k = c['t'], c['kind']
    if t < 0:
        continue
    if k == 'type':
        n = hz(rng.choice([0, 2, 4, 7, 9, 12, 14, 16]) + 12)
        add(sfx_l, sfx_r, t, lowpass(tone(n, 0.045, 'square'), 5000) * expenv(0.045, 50), 0.045, pan=rng.uniform(-0.3, 0.3))
    elif k == 'pop':
        add(sfx_l, sfx_r, t, sweep_tone(700, 260, 0.09) * expenv(0.09, 30), 0.2)
    elif k == 'strike':
        x = np.concatenate([bandnoise(0.05, 700, 1500), bandnoise(0.05, 1500, 3000), bandnoise(0.06, 3000, 6000)])
        add(sfx_l, sfx_r, t, x * np.sin(np.linspace(0, np.pi, len(x))), 0.12)
    elif k == 'crumble':
        for i in range(5):
            f = rng.uniform(1500, 4000)
            add(sfx_l, sfx_r, t + i * 0.035 + rng.uniform(0, 0.02), bandnoise(0.04, f * 0.7, f * 1.3) * expenv(0.04, 80), 0.18, pan=rng.uniform(-0.5, 0.5))
    elif k == 'wobble':
        n = int(0.4 * SR)
        tt = np.arange(n) / SR
        f = 260 * 2 ** (tt / 0.35) + 40 * np.sin(2 * np.pi * 18 * tt)
        x = signal.sawtooth(2 * np.pi * np.cumsum(f) / SR, 0.5) * np.minimum(1, tt * 50) * np.exp(-tt * 6)
        add(sfx_l, sfx_r, t, x, 0.2)
    elif k == 'sparkle':
        for i, sm in enumerate((0, 4, 7, 12)):
            add(sfx_l, sfx_r, t + i * 0.055, tone(hz(sm + 12), 0.32, 'sine') * expenv(0.32, 12), 0.09, pan=(i - 1.5) * 0.3)
    elif k == 'photo':
        add(sfx_l, sfx_r, t, highpass(rng.standard_normal(int(0.035 * SR)), 3000) * expenv(0.035, 60), 0.25)
        add(sfx_l, sfx_r, t + 0.07, highpass(rng.standard_normal(int(0.05 * SR)), 2000) * expenv(0.05, 50), 0.18)
        for i, sm in enumerate((0, 7, 12)):
            add(sfx_l, sfx_r, t + 0.15 + i * 0.07, tone(hz(sm), 0.4, 'sine') * expenv(0.4, 9), 0.07)
    elif k == 'flip':
        x = np.concatenate([bandnoise(0.12, 300, 900), bandnoise(0.12, 900, 2000), bandnoise(0.11, 2000, 4000)])
        add(sfx_l, sfx_r, t, x * np.sin(np.linspace(0, np.pi, len(x))), 0.16, pan=-0.2)
        add(sfx_l, sfx_r, t + 0.1, sweep_tone(300, 900, 0.25) * expenv(0.25, 8), 0.05, pan=0.2)
    elif k == 'shatter':
        add(sfx_l, sfx_r, t, highpass(rng.standard_normal(int(0.5 * SR)), 2500) * expenv(0.5, 9), 0.3)
        for _ in range(12):
            add(sfx_l, sfx_r, t + rng.uniform(0, 0.35), sweep_tone(rng.uniform(2500, 6000), rng.uniform(2000, 5000), 0.12) * expenv(0.12, 30), 0.05, pan=rng.uniform(-0.8, 0.8))
        add(sfx_l, sfx_r, t, sweep_tone(120, 50, 0.25) * expenv(0.25, 12), 0.25)
    elif k == 'on':
        add(sfx_l, sfx_r, t, tone(hz(0), 0.18, 'sine') * expenv(0.18, 14), 0.12)
        add(sfx_l, sfx_r, t + 0.09, tone(hz(7), 0.28, 'sine') * expenv(0.28, 10), 0.12)

# light room reverb on everything musical
ir_n = int(0.9 * SR)
ir = rng.standard_normal(ir_n) * np.exp(-np.arange(ir_n) / SR * 5.5)
ir = lowpass(ir, 5000) * 0.012
L = L + signal.fftconvolve(L, ir)[:N]
R = R + signal.fftconvolve(R, ir[::-1] * 0.95)[:N]
L *= 0.75
R *= 0.75
L += sfx_l
R += sfx_r

# master: fade in/out, soft clip, normalise
fade = np.ones(N)
fi = int(1.2 * SR)
fade[:fi] = np.linspace(0, 1, fi)
fo_start = int((dur - 3.5) * SR)
fade[fo_start:] = np.linspace(1, 0, N - fo_start) ** 1.5
mix = np.stack([L, R], 1) * fade[:, None]
mix = np.tanh(mix * 1.6) / 1.6
mix = mix / (np.abs(mix).max() + 1e-9) * 0.89
mix = mix[: int(dur * SR)]

import wave

with wave.open(sys.argv[4], 'wb') as w:  # noqa: E305
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('wrote', sys.argv[4], f'{dur:.1f}s')
