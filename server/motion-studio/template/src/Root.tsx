import { Composition } from "remotion";
import { VIDEO } from "./config";
import { DURATION_IN_FRAMES } from "./duration";
import { Video } from "./Video";

if (
  !Number.isInteger(DURATION_IN_FRAMES) ||
  DURATION_IN_FRAMES < VIDEO.minDurationInFrames ||
  DURATION_IN_FRAMES > VIDEO.maxDurationInFrames
) {
  throw new Error(
    `DURATION_IN_FRAMES in src/duration.ts is ${DURATION_IN_FRAMES}; it must be a whole number from ${VIDEO.minDurationInFrames} to ${VIDEO.maxDurationInFrames} (${VIDEO.minDurationInFrames / VIDEO.fps}-${VIDEO.maxDurationInFrames / VIDEO.fps}s at ${VIDEO.fps} fps).`,
  );
}

// The server renders the composition with id "Main". Keep the id and the VIDEO settings.
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Main"
      component={Video}
      width={VIDEO.width}
      height={VIDEO.height}
      fps={VIDEO.fps}
      durationInFrames={DURATION_IN_FRAMES}
    />
  );
};
