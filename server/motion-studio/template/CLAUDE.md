# Video job workspace

This folder is one video job. You run unattended on a server: nobody can answer questions or
approve anything, so never ask; decide yourself and keep going until the video is finished.
Work only inside this folder.

Follow the motion design skill in your system prompt (SKILL.md and all of its references are
included there in full).

## Files

- `BRIEF.md`: the user's request, followed by any change requests.
- `context.md` and `public/context/`: text and images fetched from links in the request (absent when
  there were none). Use an image with `staticFile("context/<name>")`.
- `public/uploads/`: images the user attached to the request or to change requests (listed in
  `BRIEF.md`). Use one with `staticFile("uploads/<name>")`.
- `SOUNDS.md` and `public/sfx/`: the sound-effect library, one line per sound (file, length, what it
  is for). Play one with `staticFile("sfx/<id>.mp3")`.
- `src/config.ts`: size, fps, requested length and the allowed duration range, written by the server.
  Do not edit.
- `src/duration.ts`: `DURATION_IN_FRAMES`, the video's length. Start from the requested length
  (`VIDEO.minDurationInFrames`); raise it up to `VIDEO.maxDurationInFrames` only if the ending needs
  room to settle. Values outside that range fail the build. (Jobs created before this file existed
  have a fixed `VIDEO.durationInFrames` instead.)
- `src/Root.tsx`: registers composition `Main` with the `VIDEO` settings and `DURATION_IN_FRAMES`.
  Keep the id and those settings.
- `src/Video.tsx`: placeholder entry component. Replace it.
- `PLAN.md`: write a short storyboard here before you code; the user sees it live.

## Commands

```bash
npm run check                    # typecheck; must pass before you finish
npm run stills                   # 9 frames spread over the video -> review/rNN/
npm run stills -- 118 120 122    # exact frames
node scripts/voice.mjs 01-name "[warmly] Line text."   # narration only, when the run prompt says it is ON
```

Check your work by rendering stills and reading the images, then revise.
Do not run `npm run render`, start Studio, or install packages: when you finish, the server publishes
`src/` and the user's browser compiles it and plays composition `Main` from `src/index.ts` live
(Remotion Player), so keep that entry and composition. Because it plays in the browser, load files
from `public/` only through `staticFile()`: never `import` an image, sound or font file. The user
renders the MP4 later if they want one. Installed: `remotion`,
`@remotion/transitions`, `@remotion/google-fonts`, `@remotion/shapes`, `@remotion/paths`,
`@remotion/noise`, `@remotion/layout-utils`, `@remotion/motion-blur`, `@remotion/media`.

## Sound

Give the film a sound design from the library: one effect on each visible event (an entrance, a
transformation, an impact, a click, typed text, the logo landing), timed to the frame it happens on,
never two loud ones at once. Place each in a `<Sequence from={frame} layout="none">` with
`<Audio src={staticFile("sfx/<id>.mp3")} volume={0.8} />` (`Audio` from `@remotion/media`). The stills
have no sound: check the timing against the frames in your plan.

## Remotion rendering facts

- Frames render independently: drive every animation from `useCurrentFrame()`. CSS transitions and
  animations, `Math.random()` (use `random(seed)` from `remotion`), `Date.now()` and data fetching at
  render time do not render correctly.
- `spring()` takes `damping` as an absolute coefficient, not a ratio:
  `damping = ratio * 2 * Math.sqrt(stiffness * mass)`.

Finish with a 2-3 sentence summary of the video.
