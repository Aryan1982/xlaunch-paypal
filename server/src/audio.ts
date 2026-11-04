import fs from "fs";
import path from "path";

/** The sound-effect library: pack.json lists every sound, its mp3 is beside it in sfx/. */
export const AUDIO_DIR = path.resolve(__dirname, "..", "assets", "audio");

export type SfxItem = {
  id: string;
  kind: "sfx";
  /** The mp3, relative to AUDIO_DIR. */
  file: string;
  description: string;
  tags: string[];
  durationSec: number;
  /** What the sound is for (logo, transitions, ui, moments, end, motion). */
  group?: string;
};

let cache: SfxItem[] | null = null;

export const sfxItems = (): SfxItem[] => {
  if (cache) return cache;
  try {
    const { items } = JSON.parse(fs.readFileSync(path.join(AUDIO_DIR, "pack.json"), "utf8")) as { items: SfxItem[] };
    cache = items.filter((i) => i.kind === "sfx");
  } catch {
    cache = [];
  }
  return cache;
};
