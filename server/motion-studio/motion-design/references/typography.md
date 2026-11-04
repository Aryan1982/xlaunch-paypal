# Typography in motion

## Direction

- **One family, few weights.** Benchmark films use one sans family throughout; emphasis comes from colour or a second beat, not from bold. Load fonts with `@remotion/google-fonts` (e.g. Inter, Manrope, DM Sans, Plus Jakarta Sans, Geist, Poppins, Instrument Serif for accents, JetBrains Mono for technical brands). Match the brand's font when it is known.
- **Sentence or title case, default tracking.** Tighten tracking (-1 to -3 %) only at very large sizes.
- **Periods as rhythm.** Short phrases ending in periods ("Write. Check. Send.") can work as a beat device, but it is one option, not the default ending.

## Sizes (at 1920×1080)

| Role | Size | Notes |
|---|---|---|
| Quiet caption | 44–64 px (cap height 3–4 % of frame height) | lots of empty space; makes the rare big word land |
| Hero word / line | 100–160 px (cap height 8–11 %) | at most a few moments per film if the type voice is "small captions" |
| Kinetic headline (type-led films) | 110–140 px, phrase width 30–55 % of frame | |
| In-UI body after a push-in | renders at 18–24 px in the UI, enlarged by the camera | |
| Labels under icons / nodes | 18–28 px | labels, not slides |
| URL / CTA text | 28–40 px | small and late |

Pick a type voice (SKILL.md dials) and keep its scale system consistent across the film.

## Building a line

Text is never shown whole up front. Words arrive one at a time.

**Pop + glide** (kinetic headline)
Each new word appears on one frame with a micro-settle (≤25 px or ≤10 % scale, 100–130 ms expo-out). Because the line is centred, the existing words slide to keep the line centred (130–400 ms expo-out). The reader sees one moving phrase, not jittering fragments. A newcomer can arrive ~20 px low or with a slightly wider gap and settle into place.

**Focus pull** (quiet caption)
Each word goes from blurred (6–8 px), ~20 % opacity and lighter colour, offset ≈ ⅓ word-space, to sharp, full opacity and ink, over 170–330 ms. Words sit at their final layout positions (no re-centring); the whole line drifts slowly. Stagger 120–380 ms with speech-like irregularity.

**Blur-in** (fast caption)
Opacity 0 → 1 with blur 4–8 px → 0 over 85–170 ms and a ≤10 px horizontal settle. Some words can enter grey and darken.

Stagger: 120–380 ms per word (longer for dramatic pauses). Never slide whole lines up from below as the default entry, and never bounce.

## Replacing a line

- **Scale-through:** the old line shrinks (ease-in, blur rising) for 270–420 ms; the new one slams in at ~2× with 15–20 px blur and settles over 200–400 ms.
- **In-place swap:** if the next word has the same position and size, just swap it on a beat.
- **Blur out:** whole-line blur + fade in 40–70 ms, then the next line builds in the same spot.
- **Smear:** a horizontal or zoom smear (~170–300 ms, ease-in) into the next scene.
- **Defocus + drift** when the camera moves on.

Exits are always faster than entries.

## Emphasis

One accent per line, maximum.
- **Gradient fill** on the key word (a horizontal 2-stop gradient in the brand ramp), connective words in near-black or grey. Alternating gradient and plain words across a sentence creates cadence.
- **Accent colour as a second beat:** the word lands in the body colour and shifts to the accent ~130 ms after it settles.
- **Light sweep:** a soft radial glow (in the accent colour) travels across the key word over 700–1000 ms, or a gradient fill sweeps through it. Use it to foreshadow the brand colour.
- **Italic serif accent** inside a sans line, only if the brand typography supports it.
- **Isolation by camera:** instead of re-typesetting a keyword big on a blank card, fly the camera into it in its real context (3–4×), with the context faded to ~25 % and blurred.

## Big type moments

- **Gradient-mask reveal:** a big word resolves left → right (leading letters solid, trailing letters blurred and lighter) over ~170 ms, or rises out of a vertical mask where glyph tops are solid and bottoms fade into the ground (~600 ms expo-out).
- **Repeated-word texture:** a word repeated in a row, mixing solid and ~40 % glyphs, sliding horizontally, with a giant translucent copy behind it drifting at a different speed (parallax type).
- **Type as image:** a counter or letterform becomes a window or mask for an image; it then scales up to fill the frame.
- **Wordmark build:** per-glyph opacity fades (~200 ms each, ~200 ms stagger) without movement, with the mark sliding over to make room; or the wordmark arrives in two chunks with exaggerated gaps that close over ~270 ms.

## Typing and generated text

- **Typing:** a constant 25–40 ms per character, a thin caret right after the last glyph. In macro, the camera tracks the caret; line wraps are 130–170 ms blurred mini-whips. Typing makes long copy watchable fast; nobody needs to read all of it.
- **Generated (AI) text:** streams in at one word per 40–100 ms or in 2–4-word chunks. The newest 1–3 words render in the accent colour, blurred and lighter, and resolve to body colour in ~100 ms (a "leading edge"). Pair with a small spinner or loader. Alternative: phrases fly in on curved, rotated paths (15–25°) and settle into their lines, overlapping (500–650 ms per phrase).
- **URLs** type on small below the logo at ~50–70 ms per character, after the logo settles.

## Holds and readability

- A line is held 400–800 ms after its last word; the key line up to 1.2 s; a single-word card 170–400 ms.
- Text needs ≥4.5:1 contrast against what is behind it at rest. Over busy UI, use a veil or a focus blur behind it.
- Masks: when a word rises out of a mask, the mask must be taller than the glyphs' ascenders and descenders at rest (no clipped "g" or "y").
- Never animate letter-spacing on body text; never stretch type non-uniformly.
