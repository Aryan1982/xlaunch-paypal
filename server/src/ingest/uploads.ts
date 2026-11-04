import fs from "fs/promises";
import path from "path";
import { z } from "zod";

import { assetsDir } from "../store";

/**
 * Reference images the user attaches in the prompt bar (screenshots of their
 * product, UI they like): at most 3 per message, copied into the film's
 * workspace for its agent to look at.
 */

export const MAX_REFERENCES = 3;
const MAX_BYTES = 6 * 1024 * 1024;

export const ReferenceUploadSchema = z
  .array(
    z.object({
      type: z.enum(["image/png", "image/jpeg", "image/webp"]),
      /** base64, with or without a data: prefix */
      data: z.string().min(16),
    })
  )
  .max(MAX_REFERENCES);
export type ReferenceUpload = z.infer<typeof ReferenceUploadSchema>;

/** Save uploads into the project's assets as `<prefix>-<n>.<ext>`; returns the file names. Throws on a bad image. */
export async function saveReferences(projectId: string, uploads: ReferenceUpload, prefix = "ref"): Promise<string[]> {
  const dir = assetsDir(projectId);
  await fs.mkdir(dir, { recursive: true });
  const names: string[] = [];
  for (const [i, up] of uploads.entries()) {
    const bytes = Buffer.from(up.data.replace(/^data:[^,]*,/, ""), "base64");
    if (bytes.length < 100 || bytes.length > MAX_BYTES) throw new Error(`Reference image ${i + 1} is empty or larger than 6 MB.`);
    const png = bytes[0] === 0x89 && bytes[1] === 0x50;
    const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const webp = bytes.subarray(8, 12).toString("ascii") === "WEBP";
    if (!png && !jpg && !webp) throw new Error(`Reference image ${i + 1} is not a PNG, JPEG or WebP image.`);
    const name = `${prefix}-${i + 1}.${png ? "png" : jpg ? "jpg" : "webp"}`;
    await fs.writeFile(path.join(dir, name), bytes);
    names.push(name);
  }
  return names;
}
