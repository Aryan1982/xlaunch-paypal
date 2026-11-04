# Timing and easing

All durations are in milliseconds, because the render frame rate is configurable. Convert with `Math.round(ms * fps / 1000)`. As a guide: 100 ms is 3 frames at 30 fps and 6 frames at 60 fps.

## The character of benchmark motion

- **Fast start, long soft landing.** Most of the travel happens in the first 25–30 % of the duration, followed by a long deceleration. This is an exponential ease-out.
- **No elastic bounce.** Settles have zero overshoot, or at most 1–2 % (a few px). Energy comes from speed contrast, blur and overlap, not springiness.
- **Asymmetric big moves.** Camera pushes and whips accelerate briefly and decelerate long, with about a 1 : 3 ratio (e.g. 400 ms in, 1200 ms out).
- **Exits accelerate away (ease-in) and are always shorter than entries.**
- **Constant overlap.** The next thing begins while the last is still settling.

## Curve library

| Name | Bezier | Use |
|---|---|---|
| expo-out (default) | `0.16, 1, 0.3, 1` | entries, settles, camera landings, card swings, re-centring |
| quint-out | `0.22, 1, 0.36, 1` | slightly softer entries, UI builds |
| ease-in (exit) | `0.7, 0, 0.84, 0` | exits, scale-through shrink, push-to-cut, fly-outs |
| in-out (camera) | `0.65, 0, 0.35, 1` | medium camera moves between two rests, cursor travel, deck shifts |
| asymmetric launch | `0.5, 0, 0.1, 1` | big pushes and whips: short acceleration, very long deceleration |
| linear | — | only for constant motion without visible start/stop (drift, idle rotation, ticker, typing rate, light sweeps across a word) and for opacity changes under 100 ms |

Springs are acceptable for small UI pops if critically damped (no visible overshoot). Never use default bouncy springs for camera or large objects.

## Measured durations

These are the ranges measured across the benchmarks. Use the lower end for punchy brands and short videos, the upper end for calm, premium ones.

### Text
| Action | Duration | Notes |
|---|---|---|
| Word entry (pop + micro-settle) | 0 ms fade, 100–130 ms settle | ≤25 px travel or ≤10 % scale, expo-out |
| Word entry (focus pull) | 170–330 ms | blur 6–8 px → 0, opacity 0.2 → 1, slide ≈ ⅓ of a word-space; sharpness arrives slightly before full opacity |
| Word stagger | 120–380 ms | irregular like speech; dramatic pause up to 550 ms |
| Line re-centre after a new word | 130–400 ms | expo-out; the whole line glides |
| Oversized blurred slam-in (replacing a line) | 200–400 ms | from ~2× scale, blur 15–20 px → 0 |
| Line hold after last word | 400–800 ms | key line up to 1.2 s; final summary up to 1.5 s |
| Text exit (blur + fade) | 40–170 ms | always faster than the entry |
| Scale-through exit | 270–420 ms | ease-in shrink to ~25–35 %, blur ramps up |
| Per-glyph fade (wordmark) | ~200 ms each, ~200 ms stagger | opacity only, letters do not move |
| Random per-glyph materialise | 270–330 ms total | glyphs in random order |
| Typing | 25–40 ms per character | constant rate; spaces take a step too |
| Streaming generated text | 1 word per 40–100 ms, or 2–4-word chunks every 70–100 ms | newest words in accent, blurred, resolving in ~100 ms |
| Accent colour as second beat | ~130–170 ms, 130 ms after the word settles | |
| Light sweep across a keyword | 700–1000 ms | linear travel, fade at the ends |

### Objects and UI
| Action | Duration | Notes |
|---|---|---|
| Icon / small element pop | 130–200 ms | scale 60 → 100 %, expo-out, no overshoot |
| Placeholder shapes fly in | 70–100 ms stagger | content fills 130–270 ms later |
| UI element build (reading order) | 100–130 ms stagger per element | 1–2 px settle |
| UI plane swing-in (rotateY) | 330–550 ms | from edge-on or 45–60° to 10–20°, expo-out |
| UI card rise from below | 600–830 ms | most travel in the first 200 ms, vertical blur early |
| 3D object entrance (edge-on → face) | ~1000–1250 ms total | content resolves in the last 400–550 ms |
| Card lift on select | ~170 ms | scale 1.3–1.5×, background defocus over the same time |
| Colour state change | ~170 ms | |
| Press (squash) | 60–70 ms down, ~100 ms up | target scales 0.88–0.95 |
| Check / stroke draw | ~170 ms | ease-in-out |
| Underline draw | 130–250 ms each | 70–120 ms stagger across items |
| Chart draw-on | 700–850 ms | segments staggered 100–200 ms |
| Table column fill sweep | ~420 ms | |
| Counter 0 → 100 | 1.0–1.4 s | expo-out: ~70 % of the range in the first ~10 % of time, then hold 300 ms at the final value |
| Deck shift (front ↔ back) | ~330 ms | in-out |
| Morph step (shape → shape) | 70–200 ms per step | one property per step |
| Ripple / shockwave ring | 400 ms | expo-out; trailing thin ring fades over ~650 ms |
| Burst particles | 200 ms burst, 1.3 s fall | use once per film at most |

### Camera
| Action | Duration | Notes |
|---|---|---|
| Creep during a hold | whole hold | 2–14 % scale over 1–1.5 s, linear or very soft |
| Push-in / launch | 1.5–2 s | ~400 ms acceleration, ~1.2 s deceleration, 2.5–4× scale |
| Recentre after a reveal | 270–400 ms | starts 130–200 ms *after* the reveal |
| Track along a rail | ~1000 ms | in-out |
| Pull-back reveal | 300–700 ms | expo-out |
| Whip / smear | 400–900 ms total | e.g. 250 ms wind-up, 250 ms peak blur (swap here), 375 ms settle |
| Blurred "carriage-return" mini-whip | 130–170 ms | almost a cut |
| Push-to-isolate (zoom blur) | ~170 ms | 2–3× in, swap at peak |
| Roll + pull-back combo | ~400–500 ms | in-out, 15–25° roll |
| Stillness before an interaction | 200–330 ms | camera decelerates to near zero, then the action triggers the next move |
| Click-triggered move | 70 ms burst + ~700 ms settle | expo-out |
| Final lock-up settle | 500–1000 ms | long expo-out into total stillness |

## Stagger and overlap rules

- **Siblings** (words, list rows, icons): 50–150 ms apart. Fewer items → longer stagger; more than 8 items → 30–50 ms or group them.
- **Sequential actions**: start the next one at 50–70 % of the previous one's duration (overlap 60–130 ms).
- **Order**: reading order for UI and lists; centre-out for radial bursts; nearest-to-camera first for depth stacks.
- **Variation**: stagger offsets may vary ±20 % (seeded) so lists don't feel mechanical; never randomise per render.

## Holds

- A beat should not hold a finished composition for more than ~1.2 s without a new event (except the final card).
- Single-word cards: 170–400 ms. A short line: 400–800 ms after it completes. Readable UI moment: 1.0–1.5 s.
- A list of N one-word hits: one per pulse beat (430–520 ms), slightly accelerating.

## Pulse

Pick a tempo at the start and derive beat lengths from it:

| BPM | Beat | Two beats |
|---|---|---|
| 116 | 517 ms | 1034 ms |
| 120 | 500 ms | 1000 ms |
| 128 | 469 ms | 938 ms |
| 138 | 435 ms | 870 ms |

Put structural events (beat changes, big moves, key word hits, the logo settle) on beats. Let micro-events (keystrokes, ticks, small pops) follow the action.
