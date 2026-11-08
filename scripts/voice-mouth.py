"""Vexa's mouth: how open it is through each narration line, for the site's lip-sync.

Reads every public/site/voice/*.mp3 (ffmpeg decodes it), measures its loudness
every 50 ms, and writes components/site/voiceMouth.json: per file, one digit
per 50 ms — 0 closed, 1-3 more and more open. Run it after
scripts/render-site-voice.py adds or changes a line:

    uv run --python 3.13 --with numpy python scripts/voice-mouth.py
"""

import json
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
VOICE = ROOT / "public/site/voice"
OUT = ROOT / "components/site/voiceMouth.json"
RATE = 16000
STEP = RATE // 20  # 50 ms


def levels(mp3: Path) -> str:
    pcm = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(mp3), "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"],
        check=True,
        capture_output=True,
    ).stdout
    x = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768
    n = len(x) // STEP
    rms = np.sqrt((x[: n * STEP].reshape(n, STEP) ** 2).mean(axis=1))
    loud = rms / max(np.percentile(rms, 95), 1e-6)
    # Closed in the gaps between words; three openings for the rest.
    lv = np.digitize(loud, [0.12, 0.4, 0.75])
    return "".join(str(int(v)) for v in lv)


def main() -> None:
    out = {p.name: levels(p) for p in sorted(VOICE.glob("*.mp3"))}
    OUT.write_text(json.dumps(out, indent=0) + "\n", encoding="utf-8")
    print(f"{len(out)} lines -> {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
