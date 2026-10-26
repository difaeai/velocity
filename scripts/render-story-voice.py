"""Render the homepage story's narration: components/site/storyVoice.json -> public/site/voice/{key}.mp3.

Kokoro-82M (Apache-2.0), on this machine, no key and no bill; voice af_heart.
Run from the repo root:

    uv run --python 3.13 --with kokoro==0.9.4 --with soundfile python scripts/render-story-voice.py

ffmpeg must be on PATH: it turns each line into a 64 kbps mono MP3 with a short
fade, so a voice never clicks in or out.
"""
import json
import pathlib
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf
from kokoro import KPipeline

ROOT = pathlib.Path(__file__).resolve().parent.parent
LINES = json.loads((ROOT / "components/site/storyVoice.json").read_text(encoding="utf-8"))
OUT = ROOT / "public/site/voice"
VOICE = "af_heart"
RATE = 24_000

OUT.mkdir(parents=True, exist_ok=True)
pipe = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")

for line in LINES:
    audio = [chunk for _, _, chunk in pipe(line["text"], voice=VOICE, speed=0.98)]
    # A breath before and after the line.
    pad = np.zeros(int(RATE * 0.25), dtype=np.float32)
    wav = np.concatenate([pad, *[np.asarray(a, dtype=np.float32) for a in audio], pad])
    with tempfile.TemporaryDirectory() as tmp:
        raw = pathlib.Path(tmp) / "line.wav"
        sf.write(raw, wav, RATE)
        dst = OUT / f"{line['key']}.mp3"
        secs = len(wav) / RATE
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-af",
             f"afade=t=in:d=0.05,afade=t=out:st={secs - 0.1:.2f}:d=0.1,loudnorm=I=-16:TP=-1.5",
             "-ac", "1", "-ar", "24000", "-b:a", "64k", str(dst)],
            check=True,
        )
    print(f"{dst.relative_to(ROOT)}  {secs:.1f}s", file=sys.stderr)
