import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { db, dbEnabled, must } from "./db";

/**
 * Cloudflare R2: the durable copy of every project's files. The VPS disk is
 * only a working cache (workdir.ts), so a new server can rebuild from here.
 *
 * Hard caps keep us inside the free tier (10 GB stored, 1M class A and 10M
 * class B operations a month): the server counts every billable operation it
 * makes (browsers never talk to R2; files are served from the VPS) and
 * refuses before a cap is crossed. Defaults leave 10% headroom.
 */

const accountId = process.env.R2_ACCOUNT_ID ?? "";
const bucket = process.env.R2_BUCKET ?? "";
const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? "";
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? "";

const num = (v: string | undefined, fallback: number) => (v && Number.isFinite(Number(v)) ? Number(v) : fallback);

export const STORAGE_CAPS = {
  bytes: num(process.env.R2_MAX_BYTES, 9 * 1024 ** 3),
  classA: num(process.env.R2_MAX_CLASS_A, 900_000),
  classB: num(process.env.R2_MAX_CLASS_B, 9_000_000),
};

export const storageEnabled = (): boolean => dbEnabled() && !!(accountId && bucket && accessKeyId && secretAccessKey);

export class StorageCapError extends Error {}

let client: S3Client | null = null;
const s3 = (): S3Client =>
  (client ??= new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  }));

// ---------------------------------------------------------------------------
// Counters: loaded from the database once, kept in memory, written back in
// batches (one server process owns the bucket).
// ---------------------------------------------------------------------------

const month = (): string => new Date().toISOString().slice(0, 7);

const usage = { month: "", classA: 0, classB: 0, bytes: 0, loaded: null as Promise<void> | null };
const unsaved = { classA: 0, classB: 0 };
let saveTimer: NodeJS.Timeout | null = null;

const load = (): Promise<void> =>
  (usage.loaded ??= (async () => {
    const m = month();
    const ops = must(await db().from("storage_ops").select("*").eq("month", m).maybeSingle(), "load storage ops") as {
      class_a: number;
      class_b: number;
    } | null;
    const objects = must(await db().from("stored_objects").select("bytes"), "load stored objects") as Array<{ bytes: number }>;
    usage.month = m;
    usage.classA = Number(ops?.class_a ?? 0);
    usage.classB = Number(ops?.class_b ?? 0);
    usage.bytes = objects.reduce((sum, o) => sum + Number(o.bytes), 0);
  })().catch((error) => {
    usage.loaded = null;
    throw error;
  }));

const rollMonth = () => {
  const m = month();
  if (usage.month !== m) {
    usage.month = m;
    usage.classA = 0;
    usage.classB = 0;
  }
};

export const flushStorageOps = async (): Promise<void> => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (!unsaved.classA && !unsaved.classB) return;
  const a = unsaved.classA;
  const b = unsaved.classB;
  unsaved.classA = 0;
  unsaved.classB = 0;
  const result = await db().rpc("add_storage_ops", { p_month: usage.month || month(), p_a: a, p_b: b });
  if (result.error) {
    unsaved.classA += a;
    unsaved.classB += b;
    console.error("[storage] could not save operation counts:", result.error.message);
  }
};

const count = (kind: "classA" | "classB", n = 1) => {
  usage[kind] += n;
  unsaved[kind] += n;
  saveTimer ??= setTimeout(() => void flushStorageOps(), 10_000);
};

const reserve = async (kind: "classA" | "classB", n = 1): Promise<void> => {
  await load();
  rollMonth();
  const cap = kind === "classA" ? STORAGE_CAPS.classA : STORAGE_CAPS.classB;
  if (usage[kind] + n > cap) {
    throw new StorageCapError(`R2 ${kind === "classA" ? "class A" : "class B"} operations for ${usage.month} are at the cap (${cap}).`);
  }
  count(kind, n);
};

export const storageStatus = async () => {
  await load();
  rollMonth();
  return { month: usage.month, bytes: usage.bytes, classA: usage.classA, classB: usage.classB, caps: STORAGE_CAPS };
};

/** Bytes stored for one user (their per-plan quota). Projects they deleted are kept for admins but no longer count. */
export const userStoredBytes = async (userId: string): Promise<number> => {
  const deleted = must(await db().from("projects").select("id").eq("user_id", userId).not("data->deletedAt", "is", null), "deleted projects") as Array<{ id: string }>;
  const gone = new Set(deleted.map((p) => p.id));
  const rows = must(await db().from("stored_objects").select("bytes, project_id").eq("user_id", userId), "user storage") as Array<{ bytes: number; project_id: string | null }>;
  return rows.reduce((sum, r) => (r.project_id && gone.has(r.project_id) ? sum : sum + Number(r.bytes)), 0);
};

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export type StoredObject = { key: string; bytes: number };

/** Upload (one class A op). Refuses past the byte or operation caps. */
export const putObject = async (
  key: string,
  body: Buffer,
  meta: { projectId: string; userId: string | null; contentType?: string }
): Promise<void> => {
  await load();
  const previous = must(await db().from("stored_objects").select("bytes").eq("key", key).maybeSingle(), "stored object") as {
    bytes: number;
  } | null;
  const growth = body.length - Number(previous?.bytes ?? 0);
  if (usage.bytes + growth > STORAGE_CAPS.bytes) {
    throw new StorageCapError(`R2 storage is at the cap (${(STORAGE_CAPS.bytes / 1024 ** 3).toFixed(1)} GB).`);
  }
  await reserve("classA");
  await s3().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: meta.contentType }));
  usage.bytes += growth;
  must(
    await db().from("stored_objects").upsert({
      key,
      project_id: meta.projectId,
      user_id: meta.userId && meta.userId !== "local" ? meta.userId : null,
      bytes: body.length,
      updated_at: new Date().toISOString(),
    }),
    "record stored object"
  );
};

/** Download (one class B op). */
export const getObject = async (key: string): Promise<Buffer> => {
  await reserve("classB");
  const out = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!out.Body) throw new Error(`R2 object ${key} has no body`);
  return Buffer.from(await out.Body.transformToByteArray());
};

/** Delete (free in R2), up to 1000 keys per request. */
export const deleteObjects = async (keys: string[]): Promise<void> => {
  if (keys.length === 0) return;
  await load();
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    await s3().send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }));
    const rows = must(await db().from("stored_objects").delete().in("key", chunk).select("bytes"), "forget stored objects") as Array<{
      bytes: number;
    }>;
    usage.bytes -= rows.reduce((sum, r) => sum + Number(r.bytes), 0);
  }
};

/** What is stored for a project (from the database: listing R2 would cost class A ops). */
export const projectObjects = async (projectId: string): Promise<StoredObject[]> =>
  (must(await db().from("stored_objects").select("key, bytes").eq("project_id", projectId), "project objects") as Array<{
    key: string;
    bytes: number;
  }>).map((r) => ({ key: r.key, bytes: Number(r.bytes) }));
