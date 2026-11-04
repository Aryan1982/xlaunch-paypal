import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it, vi } from "vitest";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xlaunch-uploads-"));
vi.mock("../store", () => ({ assetsDir: (id: string) => path.join(root, id, "assets") }));
const { ReferenceUploadSchema, saveReferences } = await import("./uploads");

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(200)]);

afterAll(() => fs.rm(root, { recursive: true, force: true }));

describe("reference uploads", () => {
  it("takes at most 3 images", () => {
    const one = { type: "image/jpeg", data: JPG.toString("base64") };
    expect(ReferenceUploadSchema.safeParse([one, one, one]).success).toBe(true);
    expect(ReferenceUploadSchema.safeParse([one, one, one, one]).success).toBe(false);
    expect(ReferenceUploadSchema.safeParse([{ type: "image/gif", data: one.data }]).success).toBe(false);
  });

  it("saves data URLs by their real format", async () => {
    const names = await saveReferences("p1", [
      { type: "image/jpeg", data: `data:image/jpeg;base64,${JPG.toString("base64")}` },
      { type: "image/jpeg", data: PNG.toString("base64") },
    ]);
    expect(names).toEqual(["ref-1.jpg", "ref-2.png"]);
    expect((await fs.readFile(path.join(root, "p1", "assets", "ref-2.png"))).equals(PNG)).toBe(true);
  });

  it("rejects files that are not images", async () => {
    const text = Buffer.from("x".repeat(300)).toString("base64");
    await expect(saveReferences("p2", [{ type: "image/png", data: text }])).rejects.toThrow(/not a PNG/);
  });
});
