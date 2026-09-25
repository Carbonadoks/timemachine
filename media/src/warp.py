"""Squeeze dead time out of a take: frames that barely change play faster,
motion plays at real speed. Writes list.txt (ffmpeg concat) plus warped copies
of events.json / sfx.json so the soundtrack stays in sync.

usage: python3 warp.py <target_seconds>
"""
import json
import sys

import numpy as np
from PIL import Image

target = float(sys.argv[1])
frames = json.load(open('frames.json'))
t0 = frames[0]['t']
ts = np.array([f['t'] - t0 for f in frames])
durs = np.append(np.diff(ts), 0.5)
total = ts[-1] + 0.5

# How much each frame differs from the previous one (downsampled grayscale).
prev = None
diff = np.zeros(len(frames))
for i, f in enumerate(frames):
    im = np.asarray(Image.open(f"frames/{f['file']}").convert('L').resize((160, 90)), dtype=np.float32)
    if prev is not None:
        diff[i] = np.abs(im - prev).mean()
    prev = im

moving = diff > 0.15
# Grow motion by a little so the start and end of each move keep full speed.
kernel = int(0.12 / max(np.median(durs), 1e-3))
moving = np.convolve(moving.astype(int), np.ones(2 * kernel + 1), 'same') > 0
protect = (ts < 1.6) | (ts > total - 3.2)  # title and end cards play in full

def build(speedup, keep=0.18):
    """Static stretches keep their first `keep` seconds, the rest runs `speedup`× faster."""
    new = durs.copy()
    run = 0.0
    for i in range(len(frames)):
        if moving[i] or protect[i]:
            run = 0.0
            continue
        run += durs[i]
        if run > keep:
            new[i] = durs[i] / speedup
    return new

lo, hi = 1.0, 40.0
for _ in range(40):
    mid = (lo + hi) / 2
    if build(mid).sum() > target:
        lo = mid
    else:
        hi = mid
new = build(hi)
print(f'original {total:.1f}s → {new.sum():.1f}s (static stretches ×{hi:.1f})')

lines = []
for f, d in zip(frames, new):
    lines.append(f"file 'frames/{f['file']}'\nduration {max(d, 0.001):.5f}")
lines.append(f"file 'frames/{frames[-1]['file']}'")
open('list.txt', 'w').write('\n'.join(lines) + '\n')

# Piecewise-linear time map: original time → warped time.
new_ts = np.concatenate([[0], np.cumsum(new)[:-1]])
def remap(t):
    return float(np.interp(t - t0, ts, new_ts)) + t0

for name in ('events', 'sfx'):
    data = json.load(open(f'{name}.json'))
    for e in data:
        e['t'] = remap(e['t'])
    json.dump(data, open(f'{name}.warped.json', 'w'))
json.dump([{'file': frames[0]['file'], 't': t0}], open('origin.json', 'w'))
