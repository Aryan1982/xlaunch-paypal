# Narration (voice-over)

Only when the run prompt says **Narration is ON**. When it says OFF, there is no voice-over: do not write one, do not run `scripts/voice.mjs`, do not call ElevenLabs any other way.

The voice is chosen by the user (default **Jessica**: playful, bright, warm). `node scripts/voice.mjs` always uses it, with ElevenLabs `eleven_v3`, which performs `[expression]` tags.

## The rule that makes it work: the voice drives the text

A narrated film feels broken when the voice and the on-screen words disagree. So:

1. **Every spoken line is exactly its on-screen caption**, word for word, same order. No extra words ("just", "now", "and"), no paraphrase. If a beat has no caption, it has no voice (or add the caption).
2. **Caption words appear when they are spoken.** Generate the audio first, then time the caption words from the measured word starts. Never the other way round.
3. **Captions stay up until the line is finished:** the last word and its accent must be on screen at least 300 ms before the caption starts to exit. If the line runs long, extend the caption's exit or start the line earlier in its beat. Never cut a word off.

## Writing the lines

- One line per caption beat, 2–6 words. Spoken pace is about 2.5–3 words per second including pauses, so budget: 10 s → 3–4 lines, 20 s → 5–6, 30 s → 7–9.
- Leave at least 250 ms of silence between lines, and finish the last line at least 1 s before the end so the logo hold is quiet.
- Keep the whole script under ~400 characters (the ElevenLabs quota is shared and small). Each `voice.mjs` call spends characters, so write the final lines in PLAN.md before generating.
- **Expressions:** start each line with one tag that matches the beat's emotion, and vary them across the film like an actor would. Good tags: `[warmly]`, `[curious]`, `[excited]`, `[softly]`, `[reassuring]`, `[impressed]`, `[happy]`, `[confident]`, `[playful]`, `[thoughtful]`, `[whispers]`; sound tags `[sighs]`, `[laughs]`, `[chuckles]`, `[gasps]`.
  - A typical arc: a problem line `[sighs]` or `[thoughtful]` → the turn `[warmly]` → features `[curious]` / `[impressed]` / `[excited]` → trust `[reassuring]` → the ending `[happy]` or `[confident]`.
  - Sound tags make an audible sound (about 0.4–0.6 s) before the first word; the script accounts for it.
  - One tag per line, at the start. Punctuation shapes delivery: a comma is a short pause, a full stop a longer one, `...` a hesitation.
- Write the narration into PLAN.md's beat sheet: `t | caption = spoken line | tag`.

## Generating

```bash
node scripts/voice.mjs 01-problem "[sighs] Finder shows you filenames."
# -> public/voice/01-problem.mp3 and public/voice/01-problem.json
```

The JSON has `durationMs` and `words: [{ word, startMs, endMs }]`, where `startMs` is measured from the audio (the API's own timestamps are not reliable). Use these numbers; do not guess word times.

If a take's delivery is wrong (flat, odd stress), regenerate that line with `--seed <n>`. Do not regenerate to fix timing: retime the visuals instead.

## Placing and timing

For each line:

- `clipStart = captionFirstWordMs - words[0].startMs` (may be negative for the first line: the clip then starts before the video and its lead-in is trimmed).
- Each caption word's `at` = `clipStart + words[i].startMs`; keep each accent's original offset after its word (e.g. +250 ms).
- Re-check every caption's exit against the last word: `clipStart + durationMs + 300 ms` must be before the exit starts.
- Anything else timed to a caption word (an accent chime, a highlight, a pop) moves with that word.

Play each line once: an `<Audio>` (from `@remotion/media`) of `public/voice/<file>.mp3` inside a `<Sequence>` that starts at the line's `clipStart` (converted to frames). Any other audio (sound effects, music) dips under each line: down over about 150 ms before the line, back up over about 300 ms after it.

## Checking

You cannot listen, so check the numbers and the frames:

- For every line, list `caption word → at` next to `clipStart + startMs`; they must match.
- Render stills at the frame of each line's last word and at its accent: the whole caption must be visible and not fading.
- No two clips overlap (`clipStart + durationMs + 250 ≤ next clipStart`).
- The SFX/music track uses the ducking volume.
