---
name: motion-design
description: Benchmark-level motion design for short product, launch and explainer videos built in code (Remotion/React). Covers concept, storyboard, virtual camera, kinetic type, hand-off transitions, product UI portrayal, colour/light/depth, timing and easing. Use for anything that moves.
---

# Motion design

The bar is set by four studio-made SaaS launch and explainer films we use as benchmarks. They are very different films that share one craft:

- **The camera never really stops and almost never cuts.** Scenes hand off to each other through something physical: a shared point, a shape that becomes the next container, a push into a detail, a blur-masked whip, or a hero object that travels.
- **Fast starts, long soft landings.** Exponential ease-out everywhere, no springy bounce. Speed is sold with motion blur, not overshoot.
- **Everything overlaps.** The next element starts while the previous one is still settling.
- **Hierarchy comes from depth, focus, colour and scale,** not boxes, arrows or labels.
- **The product is rebuilt, simplified and staged as objects in space,** never a flat screenshot sitting in the middle of the frame.
- **Restraint makes the big moments loud.** Small quiet type, one accent colour, one hero move per beat, and a total stillness only at the very end.

This file is the process and the non-negotiables. The `references/` files are the craft library; they are included in full after this file.

> **Benchmarks are a standard, not a template.** The references describe mechanisms ("scale-through", "shape-collapse chain", "creep → launch"), never scenes. Do not rebuild a benchmark film: no lavender-white canvas with a blue gradient by default, no four-phone tunnel, no confetti finale, no sparkle-as-AI, no three-nouns-with-periods ending as a reflex. Every film gets its own concept, palette, motif and mix of techniques derived from *its* brief.

---

## The process (fixed order)

Write each step into `PLAN.md` before coding. A few lines each is fine.

1. **Brief → one-line idea.** What the viewer should feel and remember. Name the product's single core action (the verb: translate, fix, follow up, hire, ship…). The film is built around making that verb physical. See `references/story-and-pacing.md`.
2. **Direction card.** Make every choice in the *Variation dials* below explicitly for this brief, with a one-line reason each. This is what keeps films from looking alike.
3. **Motif.** Pick one object or shape derived from the brand or the verb (a mark, a glyph, a stroke, a token, a colour of light). It will appear early as something functional, travel through the film, and become the logo at the end.
4. **Beat sheet.** Split the duration into beats of 1.2–2.5 s (see the budget table). For each beat: what is on screen, the camera move, the one hero motion, and *how it hands off to the next beat*. Write the hand-off first; a beat without a hand-off is not finished.
5. **Build.** Write the film's own code for this brief: no stock helpers or components carried over from other films. Drive everything from one timeline of named beat start frames, not scattered magic numbers.
6. **Review with stills.** Check the hand-off frames (last 3 frames of a beat and first 3 of the next), the middle of every big move, and a frame from every hold. Use the checklist at the end of this file. Revise and re-check.

### Beat budget by length

| Length | Beats | Hand-offs | Hard cuts (max) | Final hold |
|---|---|---|---|---|
| 10 s | 4–6 | 3–5 | 1 | 1.0–1.5 s |
| 20 s | 8–12 | 7–11 | 2 | 1.5–2.5 s |
| 30 s | 12–18 | 11–17 | 3 | 2.0–3.0 s |

New information should arrive every 0.5–1 s inside a beat, even while the beat itself lasts 1.5–2.5 s (a word lands, a field fills, a card lifts, the camera turns).

---

## Variation dials (choose per brief, record in PLAN.md)

Pick one option per dial. Do not take the first option by habit; take the one the brief earns. Two films for different brands should differ on at least four dials.

| Dial | Options |
|---|---|
| **Canvas** | light neutral (warm or cool) · deep dark with a light source · saturated brand field · rotating grounds (brand / light / dark alternate per caption beat) · soft drifting gradient mesh |
| **Spatial register** | flat 2D graphic · 2.5D planes in perspective · tactile slabs on a ground plane (thick UI, long soft shadows) · deliberately mixed registers switched only on cuts |
| **Camera grammar** | one-take (zero cuts, everything hands off) · rail (the camera tracks along a line/connector between stations) · cut-on-pulse (hard cuts on a steady pulse, with motion carried across) · hybrid (one-take chapters joined by 1–2 blur-masked cuts) |
| **Type voice** | small quiet captions with rare big words · word-by-word kinetic headlines at hero size · almost no display type (labels only, the visuals carry it) · type as image (letters become masks or windows) |
| **Type face** | neutral grotesk · geometric sans · humanist light · grotesk + italic serif accent · heavy display · mono for technical products |
| **Emphasis method** | gradient fill on key words · single accent colour word · weight contrast · colour arriving as a second beat · light sweep across the word |
| **Continuity family** (lead with one, mix in others) | morph chains (shape → shape) · push-through into details · scale-through · rail tracking · hero object carry · object occlusion wipes · whip/smear |
| **Product staging** | tilted floating planes · thick physical slabs · isolated fragments (one element alone on the canvas) · depth stack of windows · macro close-ups with shallow focus |
| **Interaction** | cursor as an actor · no cursor (cut from the control to the result) · a hero object performs the action · the UI reacts on its own |
| **Energy curve** | slow build to a fast climax · fast open then calm resolution · steady pulse with one spike · accelerate into a held release |
| **Texture** | clean · fine grain on blurs and gradients · soft bloom on highlights · letterbox bars for hero beats |

Derive the palette from the brand (logo, site, product UI, attached images, `context.md`). If none is given, invent one that fits the subject. One primary, one accent, neutrals, and one glow colour. Never reuse a palette from the references.

---

## The non-negotiables

### 1. Hand off, don't cut
Every beat change is carried by something the eye can follow. Choose from `references/transitions.md`:
- a **shared point** (scale-through, push-through, pull-back reveal),
- a **shared shape** (the outgoing element becomes the incoming container: bar → pill → circle → card),
- a **shared object** (a hero object or the motif travels and the world changes around it),
- a **shared motion** (velocity carried across a cut, a whip with the swap hidden at peak blur),
- **occlusion** (an object passes in front, and the content behind it has changed).

Hard cuts are allowed only for a chapter change or a punch-in to the same layout, and only at the counts in the budget table. Never crossfade two unrelated scenes; never dip to black or white between beats.

### 2. Nothing is ever frozen until the end
Every hold keeps a slow drift: camera scale creep of 2–7 % over the hold (or about 0.3 % per 100 ms), a 0.5–1 px per frame (at 30 fps) drift, a slowly evolving background, idle rotation of 1–2° per second on floating planes. The final lock-up is the only fully still frame, held 1–3 s.

### 3. Fast start, long landing
Default curve: expo-out (`Easing.bezier(0.16, 1, 0.3, 1)`). Big moves are asymmetric: about 1 part acceleration to 3 parts deceleration. Exits use ease-in (accelerating away) and are always shorter than entries. No overshoot or elastic bounce on premium SaaS work unless the brand is explicitly playful; a 1–2 % settle is the maximum. Details and numbers: `references/timing-and-easing.md`.

### 4. Blur is speed
Anything crossing more than about a tenth of the frame per frame (at 30 fps), or scaling fast, gets directional or zoom blur proportional to its speed. Whips, push-throughs and fly-ins are never crisp in their fast middle. Swap content at the moment of peak blur.

### 5. Overlap everything
Start the next element at 50–70 % of the previous one's duration. Stagger siblings 50–150 ms. Keep consecutive actions overlapping by 60–130 ms. Sequential "A finishes, then B starts" motion reads amateur.

### 6. Hierarchy by depth, focus and colour
Highlight by **isolating** (push in, lift the element toward the camera, blur and dim the rest to about 25–40 %), never with arrows, circles or callout boxes. Depth of field is the main hierarchy tool. One saturated accent marks the story focus; everything else stays high-key and low-contrast (or low-key on dark canvases).

### 7. Product as rebuilt objects
Rebuild UI as simplified vector components (3–6 content elements, generous padding, one font, real-looking but minimal data). Stage it in space: tilted planes, slabs, isolated fragments, depth stacks. Show the product by flying into the content that matters, not by showing whole screens. See `references/product-ui.md`.

### 8. Text is read once and leaves
Copy is short (2–4 words per beat). Build it word by word, hold it 400–800 ms after the last word (longer only for the key line), and exit faster than it entered. Long text (UI body copy, generated text) is texture, not reading material. See `references/typography.md`.

### 9. Light is coloured
Shadows and glows are tinted with the palette (never neutral black at high opacity). A glow means "active" and is reserved for one element at a time. Depth comes from blur, glow and perspective, not from heavy textures. See `references/color-light-depth.md`.

### 10. End on the motif
The motif or hero object becomes (or docks into) the logo. The lock-up settles with a long ease-out (about 500–1000 ms) into total stillness. A URL or CTA, if any, arrives small and late (about 300–700 ms after the logo settles).

---

## Rhythm without audio

Rendered videos are silent unless the brief supplies sound, but they must still feel scored. Pick a pulse at the start (about 115–140 BPM: one beat is 430–520 ms) and place structural events on it: beat changes, big moves, word hits in a list (one per beat), and the logo settle. Small UI events can follow their own cadence. Accelerate the pulse into the climax (shorter beats), then release into the longer final hold. Put a brief stillness (about 200–300 ms of near-zero motion) before the biggest hit.

## Narration

The run prompt says whether narration is ON or OFF. When it is ON, follow `references/narration.md`: every spoken line is exactly its on-screen caption, each line opens with an expression tag, the audio is generated first with `node scripts/voice.mjs`, and the caption words are timed to the measured word starts. When it is OFF, no voice-over at all.

---

## Review checklist (run on stills before finishing)

- [ ] Every beat hands off. On the hand-off frames you can name what carries the eye (point, shape, object, motion, occluder).
- [ ] No frame before the final hold is perfectly identical to the previous one (drift is present).
- [ ] Fast moves show blur in their middle frames; the hand-off swap happens inside the blur.
- [ ] Each frame has one obvious focal point; everything else is softer, dimmer or smaller.
- [ ] Text: at most one accent per line, readable size, enough hold, no letters clipped by masks at rest.
- [ ] UI looks rebuilt and designed (not a box with grey lines), and is staged in space.
- [ ] Palette, type and motif come from this brief, and the Direction card choices are visible on screen.
- [ ] Nothing in the film recreates a benchmark scene.
- [ ] The last 1–3 s are the logo/lock-up at rest, fully still and fully inside the safe area (5 % margin).

---

## Reference map

| File | Read for |
|---|---|
| `references/story-and-pacing.md` | the idea, verb → visual metaphor, beat structures for 10/20/30 s, energy curves, motif threading, endings |
| `references/camera-and-space.md` | the virtual camera, creep → launch, push-through, rail tracking, whips, roll, punch-ins, depth stacks, depth of field, registers |
| `references/transitions.md` | the hand-off catalogue with timings, how to pick one, budgets and anti-repetition rules |
| `references/typography.md` | type direction, word-by-word builds, entries and exits, emphasis, sizes, holds, typing and streaming text, type as image |
| `references/product-ui.md` | rebuilding UI, staging it in space, isolation, cursor choreography, click feedback, AI generation, data viz, placeholders |
| `references/color-light-depth.md` | palettes from a brand, grounds, glows and tinted shadows, gradient meshes, grain, accent strategy |
| `references/timing-and-easing.md` | curve library, measured durations for every common action, stagger and overlap rules, ms ↔ frames |
| `references/narration.md` | only when narration is ON: writing lines with expression tags, generating them, timing captions to the voice, ducking other audio |
