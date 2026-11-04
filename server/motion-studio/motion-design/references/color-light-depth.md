# Colour, light and depth

## Palette from the brief

Build the palette from the brand (logo, site, product UI, images in `context.md`, attached uploads). If nothing is given, choose one that fits the subject's personality. Define:

| Role | Count | Notes |
|---|---|---|
| Ground(s) | 1–3 | the canvas; can rotate per beat (see below) |
| Ink | 1–2 | primary text and a grey for connective words / body |
| Primary | 1 | the brand colour; used for emphasis and key shapes |
| Ramp | 3–5 stops | light → saturated → deep versions of the primary, for gradient fills, bars and glows |
| Accent | 1 | the single saturated "look here" colour; may equal the primary |
| Flash (optional) | 1 | a contrasting colour used only for momentary reveals (pops, wipe layers, shockwaves), never as a resting colour |
| Glow | 1 | a light tint of the primary or a complementary hue, for under-glows, rim light and atmosphere |

Keep the image high-key and low-contrast on light grounds (or low-key on dark grounds) and reserve saturation for 1–2 accents. Saturation is how the viewer knows where the story is.

**Avoid as defaults** (these belong to the benchmark brands): lavender-white grounds with an indigo → azure → sky ramp; periwinkle fields with blue blobs; a Google-like four-colour stroke system; pale teal/mint frosted gradients. Any of them may be right for a specific brand; none is a house style.

## Grounds

- **Flat ground** with no texture: clean and modern; depth then comes entirely from blur, glow and perspective.
- **Drifting gradient mesh:** 2–4 large soft blobs (blur 150–250 px) of related hues, drifting at ≤4 % of frame width per second and slowly evolving. Never fast, never flat for long.
- **Corner glows:** soft tinted glows in two opposite corners give a light ground depth without lines.
- **Dark ground with a source:** a soft coloured pool of light at the bottom centre or behind the subject, like a stage light out of frame.
- **Rotating grounds:** for caption-led films, alternate brand colour → light neutral → dark neutral per beat so every phrase change is also a luminance change.
- **Background colour wash** as a transition: the whole ground tints toward the brand colour over ~100 ms just before a brand moment.

## Light and shadow

- **Tinted, never black.** Shadows are a darker, desaturated version of the palette (cool slate on cool palettes, warm brown-grey on warm), at 10–25 % opacity, very large and soft (blur 40–120 px), offset down (and right for a key light from the upper-left).
- **Coloured under-glow** for floating elements: the glow colour, blur 40–60 px, offset ~20 px down, instead of a neutral drop shadow.
- **Rim light:** a thin bright edge on the leading edge of tilted planes (a 1–2 px gradient border or an inner shadow).
- **Glow marks the active element** (blur 60–120 px, 40–60 % opacity). One glowing element at a time.
- **Specular:** a soft highlight on the top lip of slabs and on glass buttons; subtle.
- **Glass:** translucent fill with an inner gradient (light top → slightly tinted bottom), a thin gradient rim, `backdrop-filter: blur()` only if the background behind actually varies.

## Gradients

- On text: horizontal 2-stop gradients within the ramp (`background-clip: text`).
- On bars and shapes: multi-stop linear (light → saturated centre → light) or diagonal; let the gradient angle rotate slowly during holds for an idle shimmer.
- On grounds: radial or mesh, soft.
- Keep gradients within one hue family (plus at most one neighbour). Rainbow gradients look cheap.

## Texture

- **Clean** is the default for crisp SaaS.
- **Fine grain** (an SVG `feTurbulence` overlay at 3–6 % opacity, re-seeded per frame) on blurred areas prevents banding and gives a rendered, lensed feel.
- **Bloom:** a faint blurred copy of the bright elements, screen-blended, for a soft cinematic look.
- **Vignette** only when the camera is very close (it reads as the object's edges wrapping the lens), never as a permanent frame darkening.

## Foreshadowing

Introduce the brand accent early as *light* (a glow sweep across a word, a highlight on an icon, a tint on a ground) before it appears as the logo. The colour arrives as atmosphere and pays off as identity.
