import crypto from "crypto";
import { customAlphabet } from "nanoid";

import type { Account } from "./auth";
import { HttpError } from "./lib/http";
import { assertFilmAgent } from "./lib/retired";
import { isUnpaidPreview } from "./pipeline";
import { getProject, updateProject } from "./store";
import type { Aspect, Project } from "./types";

/**
 * Public share links (/s/<token>): a film's owner makes one so someone
 * without an account (a cofounder) can watch it. The token is the project id,
 * a "-" and a random secret (24 letters and digits, ~143 bits), so a link
 * finds its project without a lookup table and can't be guessed from the id.
 * The project keeps the whole token; turning the link off removes it.
 */

const secret = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", 24);

/** A share token: a project id (PROJECT_ID), "-", the secret. */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{1,64}-[A-Za-z0-9]{24}$/;

const NOT_FOUND = "This link doesn't work. Its owner may have turned it off.";

/** The caller's own project, not deleted: only its owner shares it (an admin can open anyone's, but not share it). */
const ownProject = async (account: Account, id: string): Promise<Project> => {
  const project = await getProject(id).catch(() => null);
  if (!project || project.userId !== account.id || project.deletedAt) throw new HttpError(404, "Project not found.");
  return project;
};

/** The project's share token: the one it has, or a new one. */
export const shareProject = async (account: Account, id: string): Promise<string> => {
  const project = await ownProject(account, id);
  // a link plays the film's source, which a retired scene-studio film no longer has
  assertFilmAgent(project);
  if (project.share) return project.share.token;
  const token = `${id}-${secret()}`;
  const saved = await updateProject(id, (p) => {
    p.share ??= { token, createdAt: Date.now() };
  });
  return saved.share?.token ?? token;
};

/** Turn the link off: the token stops working (a new share makes a new one). */
export const unshareProject = async (account: Account, id: string): Promise<void> => {
  const project = await ownProject(account, id);
  if (!project.share) return;
  await updateProject(id, (p) => {
    delete p.share;
  });
};

const sameToken = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * The project a share token opens; 404 for a malformed, unknown or turned-off token, or a deleted project;
 * 410 for a film from the retired scene studio (nothing can play it any more).
 */
export const sharedProject = async (token: string): Promise<Project> => {
  if (!SHARE_TOKEN.test(token)) throw new HttpError(404, NOT_FOUND);
  const project = await getProject(token.slice(0, token.lastIndexOf("-"))).catch(() => null);
  if (!project || project.deletedAt || !project.share || !sameToken(project.share.token, token)) throw new HttpError(404, NOT_FOUND);
  assertFilmAgent(project);
  return project;
};

/** What a shared film shows: enough to play it, nothing about its owner, billing, chat or how it was made. */
export type PublicShare = {
  /** The product's name. */
  title: string;
  /** The product's website host. */
  host: string;
  aspect: Aspect;
  /** The whole film's planned length (seconds). */
  seconds: number;
  /** Bumped when the film changes (the player reloads). */
  version: number;
  /** There is a film to play yet. */
  ready: boolean;
  /** A free preview: where it stops (seconds). Null once the film is paid for. */
  preview: { cut: number } | null;
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export const publicShare = (project: Project): PublicShare => {
  const agent = project.motionAgent;
  // a free preview stops at its cut (previews made before the cut was recorded stopped at 10 s, as the owner's page shows them)
  const preview: PublicShare["preview"] = isUnpaidPreview(project) ? { cut: agent?.cut ?? 10 } : null;
  return {
    title: agent?.found?.siteName || project.profile?.name || project.title,
    host: hostOf(project.url),
    aspect: project.options.aspect ?? "16:9",
    seconds: project.options.length,
    version: project.version,
    ready: (agent?.runs ?? 0) > 0,
    preview,
  };
};
