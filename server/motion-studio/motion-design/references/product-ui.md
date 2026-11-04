# Product and UI portrayal

## Rebuild, never screenshot

Every benchmark rebuilds the product as clean vector components:
- **3–6 content elements per view.** A table has ~4 rows, a dashboard ~3 widgets, a notification has an icon, a title, 2–3 lines of body and a timestamp.
- **One font**, the film's family, at real UI sizes (13–24 px), with a clear hierarchy: title semibold in ink, body regular in grey (~60 % opacity), meta in light grey.
- **Cards and windows** take their shape, corner radius, padding, shadow and borders from the product's own interface (context.md, its screenshots and images), not from a stock card look.
- **Real-looking but minimal content:** plausible names, numbers and words related to the brief. No lorem ipsum, no grey bars standing in for text on anything the camera gets close to. Grey bars are fine for distant, blurred content.
- **Third-party apps** keep only their icon tile and one signature colour; place the icon tile overlapping the window's top-left corner (~40 % outside) to name the app without text.
- If the user supplied screenshots or the site has UI images, rebuild their layout and colours faithfully but simplified. Use the image itself only when photographic content is needed (thumbnails, avatars).

## Staging in space

Pick one staging (SKILL.md dials) as the film's default and use others for contrast.

- **Tilted floating plane:** rotateY 15–60°, rotateX 5–30°; swings in from edge-on or a steep angle (330–550 ms expo-out), then keeps rotating slowly (1–2°/s). Far edge blurred; a coloured rim light or glow on the leading edge.
- **Thick slab:** the UI has real thickness (a darker side band 8–20 px), a highlight on the top lip, and a large, soft, tinted shadow offset down-right on an implied ground plane.
- **Isolated fragment:** one element (a row, a button, a field) alone on the canvas with a coloured under-glow, the rest of the UI simply gone.
- **Depth stack:** windows in Z, front sharp, rear 85–90 % scale + 8–15 px blur + lower opacity; advance the deck in ~330 ms (front slides back and blurs, next comes forward and sharpens).
- **Macro:** extreme close-up of a control or text with shallow focus.
- **Hero plane:** a dashboard at a grazing 60–70° angle whose far edge fades out.

Devices (phones, laptops) are optional. If used, show screens with real content, arranged architecturally or floating, never as a static mockup in the middle of the frame. Functional UI usually reads best deviceless.

## Builds

- **Reading order:** navigation → header → content → actions, 100–130 ms apart, each with a short expo-out settle.
- **Placeholder first:** blank rounded shapes fly in (70–100 ms stagger, with blur or short speed streaks), then fill with icons or text 130–270 ms later. Layout is read before detail.
- **Reveal through layers:** 2–3 coloured bars sweep across, the last one being the panel (~450 ms total).
- **Repeat for familiarity:** when the main product view returns later, rebuild it with the same choreography.

## Highlighting

Highlight by isolation, never by arrows, circles or callout boxes.
- **Lift:** the element scales to 1.3–1.5× and rises toward the camera (~170 ms) while the background blurs and dims to ~40 %; it can float with a slight rotation while held.
- **Push to isolate:** the camera pushes 2–3× into the element with zoom blur (~170 ms); on the next frame the element sits alone on the canvas.
- **Elevation + colour:** target rows lift (white + shadow) and gain a thin accent outline and a small pill label that scale-pops in (~170 ms, stagger ~230 ms); the rest stays flat and is later blurred.
- **One data dimension:** in tables or charts, one column or series gets a solid accent fill sweeping in (~420 ms); others are tinted only subtly.
- **Glow = active:** the active element (the AI card, the primary button) gets a soft accent outer glow (blur 60–120 px, 40–60 % opacity). Only one thing glows at a time.

## Interaction

Choose one approach for the film.

**Cursor as an actor**
- A cursor drawn in the brand's style and sized to read clearly at video size, not the OS cursor.
- Enters from off-screen, travels on a gentle curve with ease-out or in-out (330–800 ms), decelerates onto the target.
- Press: the target squashes to 0.88–0.95 for 60–70 ms; a ring or 4–6 short rays burst (~200 ms).
- A visible consequence within ~170 ms: a state change, streaming text, a camera move.
- Exits fast (~100–130 ms) once its job is done; it never lingers.

**No cursor**
Macro on the control, then cut or push straight to the result, with a spinner next to the generating content.

**Hero object performs the action**
The product's verb becomes a physical action: an object hops onto each item and fixes it on contact (1-frame state change), ~1 s per hop, slightly accelerating, 4–6 times maximum.

**Click feedback layering:** press squash → surrounding context fades (~130 ms) → state change in colour (~170 ms) → tiny settle → idle shimmer (a gradient slowly rotating).

## Showing AI and processing

- **Streaming text** with a leading edge (see `typography.md`).
- **Words flying into place** on curved paths.
- **One progress bar + counter** with an expo-out count (70 % of the range in the first ~10 % of time, 300 ms hold at the end), followed by a success state (stroke draw ~170 ms). Optional burst — once per film at most.
- **Loader ring** with streamed results appearing next to it (under 1 s total).
- **Metaphor diagrams** instead of charts: fan-in of lines from source icons into one node (aggregation), nodes popping along a connector (a process), icons orbiting with climbing badge counters (overload), cards multiplying (scale).

## Flow of a feature beat

A reliable structure: **macro detail (~1 s) → result close-up (~1.5 s) → whole card in perspective (~1.5 s) → pull-back revealing a related card.** Or the reverse for "overview → focus". Either way, every step hands off with a camera move.
