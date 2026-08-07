from __future__ import annotations

import base64
import io
import json
import wave as wave_file
from pathlib import Path

import numpy as np

SAMPLE_RATE = 12_000
SPECS = (
    ("decapitation", 0.66, 410.0, 760.0, 29.0, 7.8, "saw"),
    ("dismember_left", 0.54, 520.0, 330.0, 34.0, 9.2, "square"),
    ("dismember_right", 0.58, 260.0, 610.0, 19.0, 8.4, "triangle"),
    ("jaw_dislocation", 0.72, 190.0, 470.0, 11.0, 6.4, "sine"),
    ("shoulder_left", 0.62, 230.0, 560.0, 8.0, 5.7, "saw"),
    ("shoulder_right", 0.68, 350.0, 690.0, 23.0, 10.0, "triangle"),
)


def waveform(phase: np.ndarray, kind: str) -> np.ndarray:
    cycles = phase / (2 * np.pi)
    if kind == "square":
        return np.sign(np.sin(phase))
    if kind == "saw":
        return 2 * (cycles - np.floor(cycles + 0.5))
    if kind == "triangle":
        return 2 * np.abs(2 * (cycles - np.floor(cycles + 0.5))) - 1
    return np.sin(phase)


def synthesize(
    duration: float,
    carrier_from: float,
    carrier_to: float,
    modulator: float,
    modulation_index: float,
    carrier_wave: str,
    seed: int,
) -> np.ndarray:
    frames = round(duration * SAMPLE_RATE)
    time = np.arange(frames, dtype=np.float64) / SAMPLE_RATE
    glide = carrier_from + (carrier_to - carrier_from) * np.power(time / duration, 0.72)
    carrier_phase = 2 * np.pi * np.cumsum(glide) / SAMPLE_RATE
    vibrato = np.sin(2 * np.pi * modulator * time)
    panic = 0.45 * np.sin(2 * np.pi * (modulator * 0.37) * time + 0.8)
    phase = carrier_phase + modulation_index * vibrato + modulation_index * panic
    voice = 0.7 * waveform(phase, carrier_wave)
    voice += 0.22 * np.sin(phase * 2.03 + 0.35 * np.sin(2 * np.pi * 3.7 * time))
    rng = np.random.default_rng(seed)
    breath = rng.normal(0, 1, frames)
    breath = np.convolve(breath, np.ones(9) / 9, mode="same")
    voice += breath * (0.055 + 0.045 * np.sin(2 * np.pi * 5.3 * time) ** 2)
    attack = np.minimum(1, time / 0.018)
    release = np.minimum(1, np.maximum(0, duration - time) / 0.16)
    tremolo = 0.78 + 0.22 * np.sin(2 * np.pi * (6.5 + seed * 0.17) * time) ** 2
    signal = np.tanh(voice * 1.35) * attack * release * tremolo
    signal -= np.mean(signal)
    signal /= max(1e-9, np.max(np.abs(signal)))
    return np.asarray(np.round(signal * 29_000), dtype="<i2")


def main() -> None:
    sounds = []
    for seed, (name, duration, carrier_from, carrier_to, modulator, index, wave) in enumerate(
        SPECS, 1
    ):
        pcm = synthesize(duration, carrier_from, carrier_to, modulator, index, wave, seed)
        encoded = io.BytesIO()
        with wave_file.open(encoded, "wb") as output_wave:
            output_wave.setnchannels(1)
            output_wave.setsampwidth(2)
            output_wave.setframerate(SAMPLE_RATE)
            output_wave.writeframes(pcm.tobytes())
        sounds.append(
            {
                "name": name,
                "sampleRate": SAMPLE_RATE,
                "frames": int(pcm.size),
                "wav": base64.b64encode(encoded.getvalue()).decode("ascii"),
            }
        )
    output = Path(__file__).resolve().parents[1] / "src" / "assets" / "injury-sounds.ts"
    output.write_text(
        "export const INJURY_SOUNDS = "
        + json.dumps(sounds, separators=(",", ":"))
        + " as const;\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
