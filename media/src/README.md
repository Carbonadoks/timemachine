# How-to video tooling

Scripts that produced `../wiki-time-machine-30s.mp4`.

| File | Role |
| --- | --- |
| `clawd.js` | Overlay injected into the page: Clawd, speech bubbles, pointer, chapter chips, title cards, cursor |
| `record.mjs` | Playwright script that drives the dev server and captures a CDP screencast (1280×720 @ 1.5× → 1080p) plus event/sound-cue logs |
| `warp.py` | Speeds up static stretches to hit a target length; warps the event logs to match |
| `music.py` | Synthesises the chiptune soundtrack and mixes in the site's sound cues |

Render (with `npm run dev` running on :5173; needs `playwright-core`, Chromium, ffmpeg, numpy, scipy, Pillow):

```sh
node record.mjs                       # writes frames/, frames.json, events.json, sfx.json
python3 warp.py 29.3                  # writes list.txt + *.warped.json + origin.json
ffmpeg -f concat -safe 0 -i list.txt -vf "fps=30,format=yuv420p" -c:v libx264 -crf 18 silent.mp4
python3 music.py "$(ffprobe -v error -show_entries format=duration -of csv=p=0 silent.mp4)" origin.json events.warped.json music.wav sfx.warped.json
ffmpeg -i silent.mp4 -i music.wav -c:v copy -c:a aac -b:a 192k -shortest out.mp4
```
