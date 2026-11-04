# Camera and space

The benchmark films are shot with one virtual camera moving through a designed space. Even flat 2D scenes behave as if a camera is drifting, pushing and turning. In code, the "camera" is a wrapper that applies scale, translate and rotation to the whole world; objects live in world coordinates inside it.

## Spatial registers

Choose one per film (or deliberately alternate, switching only on cuts).

| Register | What it looks like | How |
|---|---|---|
| **Flat 2D** | Type and shapes on a ground, with camera drift and scale | 2D transforms on the world wrapper |
| **2.5D planes** | Flat UI cards and type planes placed in 3D, viewed in perspective: rotateY 15–60°, rotateX 5–30°, slight rotateZ | CSS `perspective` on the stage (1200–2500 px), `transform-style: preserve-3d` |
| **Tactile slabs** | UI as thick physical objects with rounded edges, a highlight on the top lip and long soft shadows on an implied ground plane | Stacked layers for thickness, large blurred tinted shadow offset down-right |
| **Depth stack** | Windows layered in Z: front sharp at 100 %, rear at 85–90 % scale, offset sideways, blurred 8–15 px, lower opacity | Scale + blur + opacity per layer; advance the stack in ~330 ms |

Keep registers deliberate: words in flat 2D, functional UI in 2.5D, hero objects as slabs or tilted planes. Mixing all three in one shot looks unplanned.

## Camera moves

**Creep (every hold)**
During a "static" moment, the camera scales 2–14 % over the hold and drifts a few pixels. Linear or very soft. This is both life and anticipation: big moves launch *out of* a creep.

**Launch (push-in)**
From a creep, accelerate over ~400 ms and decelerate over ~1.2 s, ending 2.5–4× closer on one detail. Blur the fast middle. Fade and blur the non-target content to ~25 % while it passes. Slight re-centring onto the target during the deceleration.

**Pull-back**
The inverse: the world shrinks around a held subject so context grows outward. 300–700 ms expo-out. Use to reveal where an element lives or to start a film from a single detail.

**Recentre after a reveal**
New elements are born off-centre (about 60 % of frame width, in the direction of travel). 130–200 ms later the camera pans 270–400 ms to bring them to centre. The reveal leads; the camera follows.

**Rail track**
The camera tracks along a line, wave or connector between "stations" (~1 s in-out per station). Old content exits one side, new content is born ahead on the line.

**Whip**
A fast pan, roll or yaw with heavy directional blur; the swap happens at peak blur (see `transitions.md` D1/D2). Add thin speed lines (2–4 px, 40–200 px long) for chapter changes.

**Roll as composition**
Rolling the camera 15–25° makes text run diagonally and turns a flat layout dynamic. Pair a roll with a pull-back or truck (400–500 ms), and un-roll on the next move.

**Follow the actor**
The camera follows the subject of an action: the caret while typing (keep it at 45–60 % of frame width), a hero object while it hops, a cursor as it travels. Slow slightly at each landing.

**Stillness before an action**
Before a click or impact, decelerate the camera to near zero for 200–330 ms so the action lands on a stable frame. The action then triggers the next fast move.

**Punch-in**
A hard cut to the same layout at 1.25–2.5× with blur + veil on everything except the focus. Counts as a cut.

## Depth of field as hierarchy

- **Tilted planes:** the far side is blurred (4–10 px), the near side sharp.
- **Select / focus:** when an element is chosen, the background defocuses and dims to ~40 % over ~170 ms (rack focus).
- **Macro shots:** shallow focus with 40–60 % of the frame sharp; the focus edge can run across a line of text so the in-focus words are read first. Lines further from the reading line get progressively softer.
- **Tilt-shift:** centre sharp, frame edges blurred, when the frame is surrounded by framing objects.
- Add fine grain to large blurs if the film's texture dial allows it (prevents banding, looks lensed).

## Depth as meaning

- Lift the items that matter (errors, selected cards, the key row) onto a higher Z layer with their own shadow; they parallax against the base plane during camera moves.
- When an item's state resolves, drop it back to the base plane.
- Parallax: nearer layers move faster. Even a uniform scale-from-centre gives a cheap parallax effect when objects sit at different distances from the centre.

## Composition

- **Assemble the world around the copy:** keep a headline centred and fly 3–5 framing objects in from different edges (100–200 ms stagger, 270–330 ms each, blurred), so the frame becomes a space. Exit them radially and keep one.
- **Big scale ranges:** going from a full card to a single phrase (3.5–4×), or into a macro (~10×), reads as "going inside" the product.
- **Hero plane:** a dense dashboard seen at a grazing 60–70° angle with its far edge fading out becomes a landscape and hides illegible detail.
- **Letterbox for hero beats:** ~2.35:1 bars (≈130 px at 1080 top and bottom) for 2–4 cinematic shots; a register shift without changing palette.
- Keep focal points inside a 5 % safe margin and avoid parking text exactly at the frame centre line for every beat; vary between centre, left third and right third when the type voice allows.
