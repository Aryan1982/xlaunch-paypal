import { VIDEO } from "./config";

// Length of the video in frames. Yours to set, between VIDEO.minDurationInFrames (the requested
// length) and VIDEO.maxDurationInFrames (a few seconds of room for the ending to settle).
export const DURATION_IN_FRAMES: number = VIDEO.minDurationInFrames;
