---
name: lowpoly-3d
description: Use this skill for every frame of a 3D film: building low-poly worlds with three.js inside Remotion, placing and moving the camera, lighting, materials, characters and devices, and keeping every frame deterministic. Read it before writing any 3D code, together with the motion-design skill.
---

# Low-poly 3D films

The film is a short 3D launch film for a product, built with three.js inside
Remotion: a stylised low-poly world (faceted geometry, flat shading, a
deliberate palette from the product's own colours) that a camera moves
through. Think a polished studio diorama, not a game engine demo and not a
slideshow of floating cards.

## How 3D runs here

- Draw 3D inside `<ThreeCanvas>` from `@remotion/three`, sized with `width`
  and `height` from `useVideoConfig()` (unsized, it renders blank). Inside
  it: react-three-fiber elements (`<mesh>`, `<group>`, lights, a camera you
  place) and anything from `three`.
- Every frame is rendered on its own and in any order. The camera, every
  light and every object is computed from `useCurrentFrame()`. Never use
  `useFrame`, `THREE.Clock`, the react-three-fiber clock, `useState`/
  `useEffect` for animation, timers, `Date.now()` or `Math.random()` (use
  `random(seed)` from `remotion`).
- Installed: `three`, `@react-three/fiber`, `@remotion/three`. There is no
  `@react-three/drei`, and there are no model, HDRI or texture files: build
  everything from three.js geometry. For text or a logo inside the world,
  draw it on a `<canvas>` and use it as a `CanvasTexture`, or put HTML over
  the canvas in an `<AbsoluteFill>` layer.
- Set the camera yourself each frame: position it, then `lookAt` the subject
  (a `<perspectiveCamera makeDefault>` updated from the frame, or move the
  scene's group instead of the camera). Keep the field of view 30-45 degrees.

## The look

- Low-poly by construction: low segment counts (an icosahedron of detail 0-1
  for rocks and trees, a cylinder of 6-8 sides for trunks and towers),
  `flatShading: true`, matte `MeshStandardMaterial` (roughness 0.7-1,
  metalness 0-0.2). One material per colour, shared.
- Palette: 4-6 colours taken from the product's brand (context.md), plus one
  warm and one cool neutral. Background as a colour or a gradient behind the
  canvas, never pure black unless the brand is.
- Light: a soft hemisphere or ambient fill, one key directional light with
  shadows (`castShadow` / `receiveShadow`, a shadow map of 1024-2048), and a
  rim light for separation. Fog to give depth.
- Scale and composition: a ground plane or platform that grounds the world,
  objects at believable relative sizes, a clear subject in each shot, depth
  in layers (foreground, subject, background).

## Motion in 3D

- The camera always moves with purpose: push in, orbit, crane up, follow a
  moving subject, glide between areas of one world. Ease every move; no
  linear camera paths and no cuts to a static camera.
- The product is the hero: its screens, devices, data or objects animate and
  transform (a screen lights up and scrolls, parts assemble, a card flips and
  becomes a panel, data rises as bars). Characters, if any, act (type, point,
  celebrate) rather than stand.
- Stagger entrances, overshoot and settle with springs, and let one element
  turn into the next instead of fading in and sitting still.

## Product screens in the world

Show the product's real interface on device screens: draw it on a canvas
texture each frame (text, cards, a cursor), or lay an HTML layer over the
canvas that tracks the device. Use the product's real words and numbers from
context.md.

## Performance

Keep it light enough to render: a few hundred meshes at most, geometries and
materials created once (`useMemo`), no per-frame allocation of geometry, and
shadows on only the key light.

## Check your work

Render stills and look at them: the subject reads at a glance, nothing is
clipped by the camera, nothing is black (lights on, materials not
unlit-black), and the picture changes meaningfully between frames.
