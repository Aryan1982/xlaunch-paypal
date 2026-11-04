import type { Project } from "../types";
import { HttpError } from "./http";

/**
 * Films made by the older scene studio (mode "2d"/"3d", or no mode on the
 * oldest projects). The studio and its scene library are gone: such a film's
 * stored data and its exported MP4 stay, but nothing can play, share, export,
 * change or build it again.
 */
const RETIRED_MESSAGE =
  "This film was made with the older scene studio, which has been retired. Its exported video is still available; make a new film to change it.";

/** 410 for a scene-studio film: every action that would need the retired scene pipeline. */
export const assertFilmAgent = (project: Pick<Project, "options">): void => {
  if (project.options.mode !== "motion") throw new HttpError(410, RETIRED_MESSAGE, { code: "retired" });
};
