"""Render original '街角的慢时光' score (no samples or third-party melody).
Needs numpy and ffmpeg. Usage: python tools/render-music.py
The score is deterministic: 24 bars, 72 BPM, D major/pentatonic melody.
"""
from pathlib import Path
import subprocess, tempfile, wave
import numpy as np

RATE = 32000
BPM = 72
BEAT = 60 / BPM
BARS = 24
SECONDS = BARS * 4 * BEAT
N = round(SECONDS * RATE)
rng = np.random.default_rng(20261020)
audio = np.zeros((N, 2), dtype=np.float64)

def note(midi, start, beats, gain, pan=0, instrument='piano'):
    duration = max(1.8, beats * BEAT + 1.2)
    t = np.arange(round(duration * RATE)) / RATE
    freq = 440 * 2 ** ((midi - 69) / 12)
    sound = np.zeros_like(t)
    if instrument == 'piano':
        for k, weight in enumerate([1, .42, .17, .075, .033, .012], 1):
            # Slightly stretched, decaying strings; fast soft hammer attack.
            f = freq * k * np.sqrt(1 + .00007 * k * k)
            sound += weight * np.cos(2 * np.pi * f * t) * np.exp(-t * (1.1 + .27 * k))
        env = (1 - np.exp(-t * 110)) * np.exp(-t / (beats * BEAT + .8))
    elif instrument == 'pluck':
        for k, weight in enumerate([1, .30, .12, .045, .02], 1):
            sound += weight * np.sin(2 * np.pi * freq * k * t) * np.exp(-t * (2 + k * .6))
        env = (1 - np.exp(-t * 160))
    else:
        sound = np.sin(2*np.pi*freq*t) + .18*np.sin(2*np.pi*freq*2*t)
        env = np.minimum(1, t/.35) * np.exp(-t/(beats*BEAT))
    sound *= env * gain
    # Deterministic circular placement retains natural release into loop start.
    index = (np.arange(len(t)) + round(start * RATE)) % N
    left, right = np.sqrt((1-pan)/2), np.sqrt((1+pan)/2)
    np.add.at(audio[:,0], index, sound * left)
    np.add.at(audio[:,1], index, sound * right)

# Warm open voicings: Dmaj9, Bm7, Gmaj9, Asus2. Four-bar harmonic breath.
chords = [[50,57,61,66], [47,54,57,62], [43,50,57,59], [45,52,57,59]]
# Original short phrases; None is a deliberate breath. Relative timing in beats.
phrases = [
 [(0,74,1),(1.5,76,.5),(2,78,1.5)],
 [(.5,81,1),(2,78,1),(3.25,76,.5)],
 [(0,74,1.5),(2,71,1),(3.25,69,.5)],
 [(.5,71,1),(2,73,1)],
 [(0,74,1),(1.5,78,1),(3,81,.75)],
 [(0,83,1.5),(2,81,1),(3.25,78,.5)],
 [(.5,76,1),(2,74,1.5)],
 [(0,73,1),(1.5,71,1),(3,69,.75)],
]
for bar in range(BARS):
    chord = chords[bar % 4]
    start = bar * 4 * BEAT
    note(chord[0], start, 3.5, .15, -.15, 'pad')
    for step, degree in enumerate([1,2,3,2]):
        note(chord[degree]+12, start + (step+.25)*BEAT, .6, .075, -.38 if step%2==0 else .38, 'pluck')
    phrase = phrases[bar % 8]
    # Middle verse is softer and sparser; final verse returns with small variation.
    for offset, pitch, length in phrase:
        if 8 <= bar < 16 and offset > 3: continue
        if bar >= 16 and bar % 4 == 2 and offset == .5: pitch += 12
        note(pitch, start + offset*BEAT, length, .16 if bar < 8 or bar >= 16 else .12, .12, 'piano')
# Small stereo room; circular tails avoid a cut-off when repeating the track.
original = audio.copy()
for delay, amount in [(.071,.10),(.113,.08),(.181,.065),(.293,.045),(.419,.025)]:
    audio += np.roll(original[:,::-1], round(delay*RATE), axis=0) * amount
# Gentle low-pass smoothing and DC removal. No compressors or loud drum transients.
audio -= audio.mean(axis=0)
peak = np.max(np.abs(audio))
audio *= .66 / max(peak, 1e-9)
# Preserve continuity through a short equal-power boundary crossfade.
blend = round(.035 * RATE)
head, tail = audio[:blend].copy(), audio[-blend:].copy()
transition = (audio[0] + audio[-1]) * .5
w = np.linspace(0,1,blend)[:,None]
audio[:blend] = transition*(1-w) + head*w
audio[-blend:] = tail*(1-w) + transition*w
pcm = np.clip(audio*32767,-32768,32767).astype('<i2')
root = Path(__file__).resolve().parents[1]
out = root/'public/audio'; out.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='meow-music-') as tmp:
    wav = Path(tmp)/'slow-corner.wav'
    with wave.open(str(wav),'wb') as f:
        f.setnchannels(2); f.setsampwidth(2); f.setframerate(RATE); f.writeframes(pcm.tobytes())
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(wav),'-af','loudnorm=I=-20:TP=-2:LRA=8','-ar','44100','-codec:a','libmp3lame','-b:a','128k',str(out/'slow-corner.mp3')],check=True)
print(f'Rendered original {SECONDS:.1f}s stereo score to public/audio/slow-corner.mp3')
