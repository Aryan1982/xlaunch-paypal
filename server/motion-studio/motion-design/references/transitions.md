# Transitions: the hand-off catalogue

A benchmark film is one continuous experience. Scene changes are carried by something physical that the eye already follows. When a cut is used, it lands on a pulse beat and motion carries across it.

For every hand-off, decide three things: **the carrier** (what the eye follows across the change), **the moment of the swap** (the instant the old content is replaced, ideally hidden by blur, scale, edge-on rotation or occlusion), and **the direction** (the exit motion should flow into the entry motion).

## Families

### A. Shared point (geometry stays, scale changes)

**A1. Scale-through** (text → text, object → object)
The outgoing element shrinks with ease-in toward the frame centre while blur ramps 0 → ~15 px (270–420 ms, to ~25–35 % size). On the next frame the incoming element starts at ~2× size, blurred 15–20 px, and decelerates to rest (200–400 ms, expo-out). Both move "away from camera", so it reads as one long dolly back. Carrier: the shared centre and the continuous direction.
- Variant **scale-continuity cut**: shot A ends mid-shrink (ease-in); shot B starts mid-shrink at ~125 % and decelerates to 100 % over ~500 ms. The velocity is continuous, so the cut disappears.
- Reverse it (grow-through) for a sense of "going in".

**A2. Push-through into a detail**
The camera pushes 2.5–4× into one element (a word, a button, a row) until that element fills the frame and becomes the next scene. Surroundings drop to ~25 % opacity and blur as the camera closes in. 1.5–2 s for a dramatic push; ~170 ms with zoom blur for a fast "isolate" push. Carrier: the element itself.

**A3. Pull-back reveal**
The camera pulls back from a held subject so its context grows around it (a card reveals the app it lives in, a single row reveals the list). 300–700 ms expo-out. Carrier: the subject never leaves.

**A4. Punch-in cut**
A hard cut to the same layout at 1.25–2.5× with everything except the focus blurred and veiled (~40–60 % white or dark veil). Reads as "look here". Use sparingly (counts as a cut), on a beat.

### B. Shared shape (morphs)

**B1. Shape-collapse chain**
The outgoing element collapses into a primitive and the next element grows out of that primitive: bar → pill → circle → icon → rounded card → content card. Each step changes **one** property (length, corner radius, fill, content) over 70–200 ms. Carrier: geometry. This is the strongest continuity device and the most distinctive; plan it on paper.

**B2. Element → abstract → data**
A colour patch from a UI element stretches into a ribbon or stream, the camera follows its leading edge, and the head caps off into a progress bar, a chart, or a connector. ~700 ms. Carrier: colour and the leading edge.

**B3. Card ↔ avatar / icon**
A card rounds its corners to a circle and shrinks while an image fades in (~400 ms in-out). Says "this became that" without text.

**B4. Line → button / container**
A hairline draws (30–70 ms), thickens into a bar, then rounds into a button (~270 ms total); the label fades in after. Works for CTAs and inputs.

**B5. Letterform → mask**
A glyph's counter (an "O", a "D") becomes a window or image mask that scales up to fill the frame. Follow it with a shockwave ring if it is the emotional peak.

### C. Shared object (carry)

**C1. Hero object carry**
One object (the motif, a brand token, a cursor, a card) stays roughly in screen space while the world moves or changes underneath it: it falls into a scene, travels across it, rides a whip into the next, and finally docks into the logo. Carrier: the object.

**C2. Clone at the invisible moment**
During a 3D flip, the object is edge-on (invisible) for 1–2 frames; spawn copies at that instant and spread them with blur over ~270 ms. Copies differ in one meaningful attribute (language, colour, user, format). Says "many" without text.

**C3. Keep one, exit the rest**
Several framing objects fly out radially (ease-in, ~200 ms, 70 ms stagger) while the camera locks onto the one that remains; that one becomes the next scene's subject.

**C4. Motif travel**
The motif moves like a comet with a soft lagging trail (6–8 frames at 30 fps behind, wide, low-opacity), and its path ends exactly where the next content appears. It can then sit as punctuation (a caret, a full stop) before becoming part of the logo.

### D. Shared motion (blur and velocity)

**D1. Whip / smear**
Directional blur builds over ~230 ms (ease-in), the content swaps at peak blur, and the incoming frame starts blurred in the same direction and clears over ~100–300 ms. Add 2–4 px speed lines for a larger chapter change. Total 400–900 ms.

**D2. 3D whip**
A roll/yaw camera swing between two UI planes: ~250 ms wind-up, ~250 ms peak blur (swap here), ~375 ms settle. The shared material (white UI) carries it.

**D3. Fly-past**
Foreground objects scale past the lens with heavy blur, masking the swap; the next UI swings in from a steep 3D angle (45–60° → 15–20°, ~500 ms expo-out).

**D4. Interaction-triggered move**
A click (or any user action) launches the next camera move: 70 ms burst, ~700 ms settle. The action motivates the transition.

**D5. Rail track**
The camera tracks along a line, wave or connector (~1 s in-out). The old station exits on one side while the next is born on the line at about 60 % of frame width; the camera then recentres. Carrier: the line.

### E. Occlusion

**E1. Object wipe**
An object passes in front of the content (rising from below, swinging in edge-first, flying across) and the content behind has changed when it clears. 400–500 ms in, ~330 ms out.

**E2. 3D entrance wipe**
A new object enters edge-on and occludes the old content while the old content's plane tilts away (rotateX, squashing); then the object rotates to face the camera and becomes the scene. ~1 s. A short focal length (small perspective) exaggerates the sweep.

**E3. Layered wipe**
2–3 coloured layers sweep across in sequence, each lagging 70–100 ms (total ~450 ms), with the final layer being the new scene. A sliver of the last accent layer may linger at the edge and fade.

**E4. Colour flash to neutral**
A saturated disc or shape pops in (~200 ms), then a neutral surface wipes across it (~330 ms), leaving a crescent or sliver that fades. Reserve the flash colour for this use.

**E5. Coin flip**
A disc appears as a thin vertical lens (rotated on Y), opens to a full disc (~200 ms), and its face wipes to the new content (~330 ms).

## Choosing

| Change in the story | Strong choices |
|---|---|
| line of copy → next line | A1 scale-through, in-place swap (same position and size), E1 object wipe |
| copy → product | A2 push into an icon or word, E2 3D entrance, B4 line → container |
| product overview → detail | A2 push-through, A4 punch-in, lift the element (see product-ui) |
| detail → context | A3 pull-back reveal |
| one feature → next feature | D2 3D whip, D5 rail track, deck shift, D3 fly-past |
| process / progress | B1 shape-collapse chain, B2 element → data |
| one → many | C2 clone at the invisible moment |
| climax → logo | C1 hero object docks into the logo, C4 motif travel, B5 letterform mask |
| chapter change | D1 whip with speed lines, or one hard cut on a beat with velocity carried across |

## Rules

- **No unrelated crossfades and no dips to black/white** between beats. Opacity fades are only allowed for small elements (text, labels, a lingering sliver).
- **Do not repeat the same hand-off back to back.** Use one family as the film's signature and vary the others. A distinctive hand-off (a morph chain, a brand-shape transition) can appear twice at most, as bookends.
- **The swap is invisible.** Content changes only behind blur, at extreme scale, edge-on, or behind an occluder.
- **Direction continuity.** If the exit goes left, the entry comes from the right. If the exit shrinks, the entry is already shrinking.
- **Hand-offs land on pulse beats.** The peak (the swap) sits on the beat; the wind-up starts before it.
