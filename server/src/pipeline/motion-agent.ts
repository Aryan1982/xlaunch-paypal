import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { createSdkMcpServer, query, tool, type CanUseTool, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import { claudeApi, config, effortFor, motionModelFor, renderGl } from "../config";
import { callContext, Stopped } from "../lib/calls";
import { mediaTools } from "../lib/media-tools";
import { assertPublicUrl } from "../ingest/netguard";
import { assetsDir, getProject, log, projectDir, setActivity, updateProject } from "../store";
import { frameOf, type MotionAgent, type MotionRunner, type Project, type Stage } from "../types";
import { closeFeed, dropSummary, firstLine, pushFeed, settleFeed, THOUGHT_MAX, type NewFeedItem } from "./feed";
import { recordSpeech, recordTokens } from "../usage/ledger";
import { assetToken } from "../lib/sign";
import { AUDIO_DIR, sfxItems } from "../audio";
import { extractUrls, gatherContext } from "./motion-context";
import { VOICE_MODEL, voiceEnabled, voiceId, voiceKey, voiceLabel, voiceSwitchedOff } from "./voice";

const execFileAsync = promisify(execFile);

/**
 * A motion film, made the way the prompt-video studio makes it: one Claude
 * agent session (Claude Code, through the Agent SDK) works in the film's own
 * Remotion workspace (server/motion-studio/template), with the
 * `motion-design` skill (server/motion-studio/motion-design: SKILL.md and
 * every file in its references/) in its system prompt. It researches the
 * links in the request, writes PLAN.md, codes the video, records its
 * narration when it is on (scripts/voice.mjs), renders stills, looks at them
 * and revises, all in that one session; then the server type-checks the code,
 * sending any failure back into the same session. A change request resumes it.
 *
 * The session signs in with the Claude Code login or with the Anthropic API
 * key (MotionRunner): the session, its tools and its prompts are the same.
 * An admin's session has a shell; anyone else's has its file tools and the
 * studio's commands as server-side tools instead (filmTools).
 */

const STUDIO = path.resolve(__dirname, "..", "..", "motion-studio");
const TEMPLATE = path.join(STUDIO, "template");
const SKILL_DIR = path.join(STUDIO, "motion-design");
/** A 3D film's own skill (low-poly three.js worlds), given beside the motion one. */
const SKILL_3D = path.join(STUDIO, "skill-3d.md");

/** What a 3D film's session is told first. */
const THREE_D_NOTE = [
  "This is a 3D film: build it as a low-poly three.js world inside Remotion (`ThreeCanvas` from `@remotion/three`, with `three` and `@react-three/fiber`), following the low-poly 3D skill in your system prompt as well as the motion design one.",
  "Plan it as camera moves through one or a few connected low-poly worlds in the product's colours, with its real interface on screens in the world.",
].join("\n");

const AGENT_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebFetch", "WebSearch", "TodoWrite"];
const REPAIR_ATTEMPTS = 2;
const POLL_MS = 1500;
/** Seconds a film may run past its requested length, for its ending to settle (src/duration.ts). */
export const VIDEO_LENGTH_SLACK = 5;

const FRONTMATTER = /^---\n[\s\S]*?\n---\n/;

/**
 * The whole `motion-design` skill (SKILL.md and every file in references/), read fresh on every
 * run and appended to the system prompt so the agent always has all of it in context.
 */
function motionSkillPrompt(): string {
  const skillFile = path.join(SKILL_DIR, "SKILL.md");
  if (!fs.existsSync(skillFile)) throw new Error(`Motion skill not found at ${skillFile}.`);
  const skill = fs.readFileSync(skillFile, "utf8").replace(FRONTMATTER, "");
  const refDir = path.join(SKILL_DIR, "references");
  const refs = fs.existsSync(refDir)
    ? fs
        .readdirSync(refDir)
        .filter((f) => f.endsWith(".md"))
        .sort()
    : [];
  return [
    "# Motion design skill",
    "",
    "Follow this skill on every run. Every reference it mentions is included in full below, in a",
    "<file> block with its path; do not look for these files on disk.",
    "",
    '<file path="SKILL.md">',
    skill.trim(),
    "</file>",
    ...refs.flatMap((f) => ["", `<file path="references/${f}">`, fs.readFileSync(path.join(refDir, f), "utf8").trim(), "</file>"]),
  ].join("\n");
}

/** A 3D film's low-poly skill, in the same form as the motion one. */
function skill3dPrompt(): string {
  if (!fs.existsSync(SKILL_3D)) throw new Error(`3D skill not found at ${SKILL_3D}.`);
  return ["# Low-poly 3D skill", "", "Follow this skill too: this film is 3D.", "", '<file path="skill-3d.md">', fs.readFileSync(SKILL_3D, "utf8").replace(FRONTMATTER, "").trim(), "</file>"].join("\n");
}

/** The session's appended system prompt: the skills (static first, for the cache), then the shell-less note. */
const systemAppend = (session: Session): string =>
  [motionSkillPrompt(), session.film3d ? skill3dPrompt() : "", session.shell ? "" : NO_SHELL].filter(Boolean).join("\n\n");

/** The film's workspace: a Remotion project of its own. */
export const workspaceOf = (id: string): string => path.join(projectDir(id), "motion");

type Format = { width: number; height: number; fps: number; seconds: number };
const formatOf = (project: Project): Format => ({ ...frameOf(project.options.aspect), fps: config.motion.fps, seconds: config.motion.seconds });

/** What a session without a shell inherits from the server's environment: enough to run, none of its secrets. */
const PLAIN_ENV = ["PATH", "HOME", "TMPDIR", "LANG", "TERM", "USER", "SHELL", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN"];

/**
 * The GL backend headless Chrome renders a film's stills and MP4 with (the template's scripts read
 * REMOTION_GL): a 3D film's three.js canvas needs one, and a 2D film is unaffected by it.
 */
const FILM_GL: Record<string, string> = Object.fromEntries([["REMOTION_GL", renderGl("3d")]].filter((e): e is [string, string] => !!e[1]));

/** What scripts/voice.mjs needs: the ElevenLabs key and the voice, set only while narration is on. */
const voiceEnv = (): Record<string, string> => ({ ELEVENLABS_KEY: voiceKey(), NARRATION_VOICE: voiceId() });

/**
 * The session's environment: the Claude Code login (CLAUDE_CODE_OAUTH_TOKEN
 * or `claude login`, never an API key) or the Anthropic API key, never both.
 * A session without a shell gets only PLAIN_ENV and that sign-in. A session
 * with one gets the ElevenLabs key and voice only when narration is on, so
 * with it off it cannot call the API at all.
 */
export const agentEnv = (runner: MotionRunner, shell = true, narrated = false): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = shell ? { ...process.env } : Object.fromEntries(PLAIN_ENV.map((key) => [key, process.env[key]]));
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_BASE_URL;
  delete env.ELEVENLABS_KEY;
  delete env.ELEVENLABS_API_KEY;
  if (runner === "api") {
    const { key, baseUrl } = claudeApi();
    if (!key) throw new Error("A motion film made with the API needs CLAUDE_API_KEY.");
    env.ANTHROPIC_API_KEY = key;
    if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
  } else {
    delete env.ANTHROPIC_API_KEY;
  }
  return { ...env, ...FILM_GL, ...(shell && narrated ? voiceEnv() : {}) };
};

const agentOf = (project: Project): MotionAgent => project.motionAgent ?? { runs: 0, frames: [] };
const patchAgent = (id: string, patch: Partial<MotionAgent>) =>
  updateProject(id, (p) => {
    p.motionAgent = { ...agentOf(p), ...patch };
  });

/** Adds an entry to the film's activity feed (pipeline/feed.ts); resolves to the id of the entry it landed on. */
const addFeed = async (id: string, run: number, item: NewFeedItem): Promise<string> => {
  let landed = "";
  await updateProject(id, (p) => void (landed = pushFeed(p, run, item).id));
  return landed;
};

/** What the agent is doing, on the project's progress. */
const STAGES: Record<"research" | "planning" | "building" | "reviewing" | "changing", { stage: Stage; activity: string }> = {
  research: { stage: "ingesting", activity: "Reading your links" },
  planning: { stage: "directing", activity: "Planning the film" },
  building: { stage: "coding", activity: "Building the film" },
  reviewing: { stage: "coding", activity: "Reviewing frames" },
  changing: { stage: "coding", activity: "Changing the film" },
};
const enter = (id: string, stage: keyof typeof STAGES) => setActivity(id, STAGES[stage].activity, STAGES[stage].stage);

/** The running job's stop switch (pipeline/index.ts exclusive). */
const stopSignal = (): AbortSignal | undefined => callContext().signal;
const checkStopped = () => {
  if (stopSignal()?.aborted) throw new Stopped();
};

/**
 * What a run makes: a whole film; a change to it (with the images attached
 * to it, workspace paths from attachToFilm); a free preview (the whole film
 * planned, only its first config.motion.previewSeconds built, in the same
 * session); or, once a preview is paid for, the rest of it (the session
 * resumed).
 */
export type MotionRun = { kind: "film" } | { kind: "change"; request: string; images?: string[] } | { kind: "preview" } | { kind: "finish" };

/**
 * Make the project's film, as `run` says, in one session (prompt-video's
 * run): research, the session, then the check, sending its errors back into
 * the session up to REPAIR_ATTEMPTS times. Once the code passes it is
 * published (`onBuilt`): the studio plays it, and an export renders it.
 */
export const runMotionAgent = async (id: string, run: MotionRun, onBuilt: () => Promise<void>): Promise<void> => {
  const project = await getProject(id);
  const ws = workspaceOf(id);
  const before = agentOf(project);
  const made = before.runs > 0 && fs.existsSync(path.join(ws, "src"));
  // a change to (or the finish of) a film that was never made makes it, with the change as part of the request
  const kind = (run.kind === "change" || run.kind === "finish") && !made ? "film" : run.kind;
  const resuming = kind === "change" || kind === "finish";
  const request = kind === "change" && run.kind === "change" ? run.request : [project.options.prompt, run.kind === "change" ? run.request : ""].filter(Boolean).join("\n\n");
  const runIndex = before.runs + 1;
  const format = formatOf(project);
  const film3d = !!project.options.film3d;
  const narrated = !!project.options.narration && voiceEnabled();
  const unvoiced =
    project.options.narration && !narrated
      ? voiceSwitchedOff()
        ? "Narration is off on this server (ELEVENLABS_ENABLED=0): the film is made without a voice-over."
        : "Narration needs ElevenLabs (ELEVENLABS_KEY): the film is made without a voice-over."
      : null;
  if (unvoiced) await log(id, unvoiced, "warn");
  // a free preview is built up to here, and played only that far
  const cut = kind === "preview" ? config.motion.previewSeconds : kind === "finish" ? (before.cut ?? config.motion.previewSeconds) : undefined;
  // a new film starts from an empty workspace; a change keeps it (restored from storage on a new server, minus the tooling)
  await patchAgent(id, resuming ? { runs: runIndex } : { runs: runIndex, frames: [], plan: undefined, summary: undefined, found: undefined, cut });
  const started = Date.now();
  const meta = [`${format.seconds} s`, project.options.aspect ?? "16:9", film3d && "3D", narrated && "narrated"].filter(Boolean).join(" · ");
  const label = kind === "change" ? "Changing your film" : kind === "finish" ? "Building the rest of your film" : kind === "preview" ? `Planning your film and building its first ${cut} s` : "Making your film";
  await addFeed(id, runIndex, { kind: "run", mode: kind, label, meta });
  if (unvoiced) await addFeed(id, runIndex, { kind: "note", text: unvoiced, level: "warn" });

  try {
    await enter(id, kind === "change" ? "changing" : kind === "finish" ? "building" : "research");
    if (resuming) restoreTooling(ws);
    else prepareWorkspace(ws, format);
    installInstructions(ws);

    let prompt: string;
    if (kind === "finish") {
      prompt = finishPrompt(cut!, narrated);
    } else {
      const images = kind === "change" ? (run.kind === "change" ? (run.images ?? []) : []) : attachToFilm(id, project.options.references ?? []);
      const contextNote = await research(id, ws, request, images, kind === "change", runIndex);
      checkStopped();
      if (kind !== "change") await enter(id, "planning");
      prompt =
        kind === "change"
          ? revisionPrompt(request, images, contextNote, narrated)
          : firstPrompt(
              request,
              [
                images.length > 0 &&
                  `The user attached ${images.length === 1 ? "an image" : `${images.length} images`} to this request: ${images.join(", ")}. Read ${images.length === 1 ? "it" : "each one"} with the Read tool before you plan. To show one in the video, use staticFile("uploads/<name>").`,
                contextNote,
                film3d && THREE_D_NOTE,
                kind === "preview" && previewNote(format, cut!),
              ]
                .filter(Boolean)
                .join("\n"),
              format,
              narrated
            );
    }
    let resume = resuming ? before.sessionId : undefined;
    const session: Session = {
      runner: project.options.motionRunner ?? config.motion.runner,
      // the project's Claude model, else config.motion.model ("opus")
      model: motionModelFor(project.options.model),
      // Sonnet always at high; Opus (or an older project's model) at its own effort, high by default
      effort: effortFor(motionModelFor(project.options.model), project.options.effort),
      shell: !!project.options.motionShell,
      film3d,
      narrated,
      portrait: format.height > format.width,
      run: runIndex,
    };
    await log(id, `Film${film3d ? " · 3D" : ""} · ${format.seconds} s · effort ${session.effort}${session.runner === "api" ? " · API" : ""}${narrated ? " · narrated" : ""}${kind === "preview" ? ` · preview (first ${cut} s)` : kind === "finish" ? " · finish" : ""}`);

    let turns = 0;
    for (let attempt = 0; ; attempt++) {
      try {
        turns += await runAgent(id, ws, prompt, resume, session);
      } catch (error) {
        // the session's transcript lives on the machine that ran it: elsewhere the run starts a new session in the same workspace
        if (!resume || error instanceof Stopped || !/No conversation found/i.test(String(error))) throw error;
        const fresh = "The earlier session is not on this server; continuing in a new session.";
        await log(id, fresh, "warn");
        await addFeed(id, runIndex, { kind: "note", text: fresh, level: "warn" });
        resume = undefined;
        turns += await runAgent(id, ws, prompt, resume, session);
      }
      checkStopped();
      resume = agentOf(await getProject(id)).sessionId;

      const checking = await addFeed(id, runIndex, { kind: "check", label: "Final check", status: "running", open: 1 });
      const problem = await typecheck(ws);
      await updateProject(id, (p) => settleFeed(p, checking, { error: !!problem, output: problem ?? "" }));
      checkStopped();
      if (!problem) break;
      if (attempt >= REPAIR_ATTEMPTS || !resume) throw new Error(problem);

      await log(id, `Final check failed, sending the error back to be fixed: ${problem.slice(0, 400)}`, "warn");
      await addFeed(id, runIndex, { kind: "note", text: "Sending the errors back to be fixed", level: "warn" });
      await enter(id, "building");
      prompt = `The server could not finish the video:\n\n\`\`\`\n${problem.slice(-6000)}\n\`\`\`\n\nFix the cause in src/, run \`npm run check\` and \`npm run stills\` to confirm, then finish with a one-sentence summary.`;
    }

    publishFilm(ws);
    await updateProject(id, (p) => {
      closeFeed(p, runIndex, "done");
      pushFeed(p, runIndex, { kind: "done", ms: Date.now() - started, turns });
    });
    await onBuilt();
  } catch (error) {
    const stopped = error instanceof Stopped || !!stopSignal()?.aborted;
    const message = error instanceof Error ? error.message : String(error);
    await updateProject(id, (p) => {
      closeFeed(p, runIndex, "stopped");
      pushFeed(p, runIndex, stopped ? { kind: "error", text: "Stopped", stopped: true } : { kind: "error", text: message.slice(0, 600) });
    }).catch(() => undefined);
    throw error;
  }
};

/** Tells the session whether this video is narrated (prompt-video's note, with this server's voice). */
function narrationNote(narrated: boolean): string {
  if (!narrated) return "Narration is OFF for this video: no voice-over, do not run scripts/voice.mjs or call ElevenLabs.";
  return `Narration is ON (voice: ${voiceLabel()}). Write and time a voice-over as the narration reference in the motion-design skill describes; generate every line with \`node scripts/voice.mjs\`, which uses this voice.`;
}

function firstPrompt(request: string, contextNote: string, format: Format, narrated: boolean): string {
  const { width, height, fps, seconds } = format;
  const max = seconds + VIDEO_LENGTH_SLACK;
  return [
    `Make a ${seconds}-second video (${width}x${height}, ${fps} fps, ${fps * seconds} frames).`,
    `Plan the storyboard for ${seconds} seconds. If the ending needs room to settle you may run up to ${max} seconds (${fps * max} frames), never shorter than ${seconds}: set DURATION_IN_FRAMES in src/duration.ts.`,
    "",
    "The request:",
    '"""',
    request,
    '"""',
    contextNote,
    narrationNote(narrated),
  ]
    .filter(Boolean)
    .join("\n");
}

function revisionPrompt(request: string, images: string[], contextNote: string, narrated: boolean): string {
  return [
    "Edit the finished video. Do not start over: change only what this request asks for by editing the existing code in src/ in place.",
    "Keep every other scene, timing, text, colour and style as it is. Do not rewrite PLAN.md or src/duration.ts unless the request needs it.",
    "Check the change with stills of the affected frames.",
    "",
    "Change request:",
    '"""',
    request,
    '"""',
    images.length > 0 &&
      `The user attached ${images.length === 1 ? "an image" : `${images.length} images`} to this request: ${images.join(", ")}. Read ${images.length === 1 ? "it" : "each one"} with the Read tool before you change anything. To show one in the video, use staticFile("uploads/<name>").`,
    contextNote,
    narrationNote(narrated),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * A free preview, in the same session as the plan: the whole film planned,
 * only its opening built, exactly as it will play in the finished film. The
 * preview stops there, mid-film, so nothing in it may wrap the film up.
 */
const previewNote = (format: Format, cut: number): string => {
  const end = Math.round(cut * format.fps);
  return [
    "",
    `This is a free preview. Plan the whole video in PLAN.md, then build only its first ${cut} seconds (frames 0-${end - 1}), exactly as they will play in the finished video.`,
    `Show the product itself well before ${cut} s, so the preview shows it. The preview stops at frame ${end}, in the middle of the video: don't end anything there. No closing card, logo lock-up, tagline or fade out before then; whatever is moving at that point is still moving.`,
    `Leave everything from frame ${end} on empty, not even placeholders: the rest is built later in this same session, from your plan, once the user buys the video. Render stills only within the first ${cut} seconds. With narration on, write every line in PLAN.md but generate only the lines said in the first ${cut} seconds.`,
  ].join("\n");
};

/** A paid preview's session, resumed: build the rest of the film it planned. */
const finishPrompt = (cut: number, narrated: boolean): string =>
  [
    `The user bought the video. Build the rest of it from PLAN.md: everything after the first ${cut} seconds you built, to the end. Do not start over: keep the first ${cut} seconds as they are, and carry their motion on across the ${cut}-second mark without a seam.`,
    narrated ? `Generate the narration lines said after ${cut} s now.` : "",
    "Check it with stills over the whole video.",
    narrationNote(narrated),
  ]
    .filter(Boolean)
    .join("\n");

function prepareWorkspace(ws: string, format: Format) {
  fs.rmSync(ws, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(ws), { recursive: true });
  fs.cpSync(TEMPLATE, ws, {
    recursive: true,
    filter: (src) => path.basename(src) !== "node_modules",
  });
  fs.symlinkSync(path.join(TEMPLATE, "node_modules"), path.join(ws, "node_modules"), "dir");
  const { width, height, fps, seconds } = format;
  fs.writeFileSync(
    path.join(ws, "src/config.ts"),
    [
      "// Written by the server for every job. Do not edit.",
      "export const VIDEO = {",
      `  width: ${width},`,
      `  height: ${height},`,
      `  fps: ${fps},`,
      `  seconds: ${seconds},`,
      `  minDurationInFrames: ${fps * seconds},`,
      `  maxDurationInFrames: ${fps * (seconds + VIDEO_LENGTH_SLACK)},`,
      "} as const;",
      "",
    ].join("\n")
  );
}

/** The template's tooling (scripts, package.json, tsconfig, node_modules) in a workspace that only has its own files. */
function restoreTooling(ws: string) {
  for (const name of fs.readdirSync(TEMPLATE)) {
    if (name === "node_modules" || name === "src" || name === "public" || fs.existsSync(path.join(ws, name))) continue;
    fs.cpSync(path.join(TEMPLATE, name), path.join(ws, name), { recursive: true });
  }
  if (!fs.existsSync(path.join(ws, "node_modules"))) fs.symlinkSync(path.join(TEMPLATE, "node_modules"), path.join(ws, "node_modules"), "dir");
}

/**
 * Images the user attached (saved as project assets) put where the agent
 * finds them, public/uploads/; returns their workspace paths.
 */
export const attachToFilm = (id: string, names: string[]): string[] => {
  const dir = path.join(workspaceOf(id), "public", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return names.flatMap((name) => {
    const file = path.basename(name);
    try {
      fs.copyFileSync(path.join(assetsDir(id), file), path.join(dir, file));
      return [`public/uploads/${file}`];
    } catch {
      return [];
    }
  });
};

/**
 * Copies the server-owned files (the template's CLAUDE.md and scripts/, the sound library) into the
 * workspace on every run, so edits to them also reach change requests on older films. The skills
 * travel in the system prompt; copies older films installed under .claude/skills are removed so
 * they never load a second, stale version.
 */
function installInstructions(ws: string) {
  fs.copyFileSync(path.join(TEMPLATE, "CLAUDE.md"), path.join(ws, "CLAUDE.md"));
  fs.cpSync(path.join(TEMPLATE, "scripts"), path.join(ws, "scripts"), { recursive: true });
  fs.rmSync(path.join(ws, ".claude", "skills"), { recursive: true, force: true });
  installSounds(ws);
}

/** The sound-effect library in the workspace: public/sfx/<id>.mp3 for stills and the render, SOUNDS.md for the agent. */
function installSounds(ws: string) {
  const dir = path.join(ws, "public", "sfx");
  fs.mkdirSync(dir, { recursive: true });
  const lines: string[] = [];
  for (const item of sfxItems()) {
    const file = path.join(AUDIO_DIR, item.file);
    if (!fs.existsSync(file)) continue;
    fs.copyFileSync(file, path.join(dir, `${item.id}.mp3`));
    lines.push(`- \`sfx/${item.id}.mp3\` (${item.durationSec.toFixed(2)} s${item.group ? `, ${item.group}` : ""}): ${item.description}`);
  }
  fs.writeFileSync(path.join(ws, "SOUNDS.md"), `# Sound effects\n\nPlay with \`staticFile("sfx/<id>.mp3")\`.\n\n${lines.join("\n")}\n`);
}

/** A motion film's source for the browser preview: its code, and where each of its public files is served. */
export type MotionSource = {
  compositionId: string;
  entryPoint: string;
  files: Record<string, string>;
  /** staticFile() names and the URL each one loads from (Remotion's window.remotion_staticFiles). */
  staticFiles: Array<{ name: string; src: string }>;
};

const CODE_FILE = /\.(tsx?|jsx?|mjs|cjs|json|css)$/;

const listFiles = (root: string, dir = ""): string[] =>
  fs.existsSync(path.join(root, dir))
    ? fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
        const rel = dir ? `${dir}/${e.name}` : e.name;
        return e.isDirectory() ? listFiles(root, rel) : e.isFile() ? [rel] : [];
      })
    : [];

/**
 * @remotion/three's own module (12 KB, from the studio template), for the
 * browser preview. Fetched from esm.sh, it would bring its own copy of
 * react-three-fiber (esm.sh builds a package's dependencies apart from the
 * same package imported directly), so a film's `useThree` would not see the
 * `ThreeCanvas` around it ("R3F: Hooks can only be used within the Canvas
 * component"). Served as a file of the film's project, it imports
 * `@react-three/fiber` exactly as the film does: one fiber for both.
 */
const REMOTION_THREE = path.join(TEMPLATE, "node_modules/@remotion/three/dist/esm/index.mjs");
const REMOTION_THREE_FILE = "remotion-three.mjs";

/** Points a film's `@remotion/three` imports at the vendored module (the preview's source only; the render uses the package). */
function vendorRemotionThree(files: Record<string, string>) {
  const uses = Object.keys(files).filter((name) => /from\s+["']@remotion\/three["']/.test(files[name]!));
  if (!uses.length) return;
  files[REMOTION_THREE_FILE] = fs.readFileSync(REMOTION_THREE, "utf8");
  for (const name of uses) {
    const up = path.posix.relative(path.posix.dirname(name), REMOTION_THREE_FILE);
    files[name] = files[name]!.replace(/from\s+(["'])@remotion\/three\1/g, `from "${up.startsWith(".") ? up : `./${up}`}"`);
  }
}

/**
 * The workspace's src/ as the preview compiles it (entry src/index.ts,
 * composition Main, as the server renders it), its public files through the
 * signed workspace route.
 */
export const motionSource = (id: string): MotionSource => {
  const ws = workspaceOf(id);
  const files: Record<string, string> = {};
  // the film as last published, not files the agent may be changing right now (a workspace restored elsewhere has only src/)
  const root = fs.existsSync(path.join(ws, PUBLISHED)) ? path.join(ws, PUBLISHED) : path.join(ws, "src");
  for (const rel of listFiles(root).filter((f) => CODE_FILE.test(f))) {
    files[`src/${rel}`] = fs.readFileSync(path.join(root, rel), "utf8");
  }
  vendorRemotionThree(files);
  const token = assetToken(id);
  const own = listFiles(path.join(ws, "public"))
    .filter((name) => !name.startsWith("sfx/"))
    .map((name) => ({ name, src: `/api/projects/${id}/motion/public/${name.split("/").map(encodeURIComponent).join("/")}?${token}` }));
  // the library is the same for every film (and may not be on this disk yet): straight from the audio route
  const sounds = sfxItems().map((item) => ({ name: `sfx/${item.id}.mp3`, src: `/api/audio/sfx/${item.id}.mp3` }));
  const staticFiles = [...own, ...sounds];
  return { compositionId: "Main", entryPoint: "src/index.ts", files, staticFiles };
};

/** Saves the request to BRIEF.md and fetches its links into context.md; returns a note for the prompt. */
async function research(id: string, ws: string, request: string, images: string[], revision: boolean, runIndex: number): Promise<string> {
  const heading = revision ? `## Change request ${runIndex - 1}` : "## Request";
  const attached = images.length > 0 ? `Attached images: ${images.join(", ")}\n\n` : "";
  fs.appendFileSync(path.join(ws, "BRIEF.md"), `${heading}\n\n${request}\n\n${attached}`);

  // only public addresses: the server fetches them
  const found = extractUrls(request);
  const urls = (await Promise.all(found.map((u) => assertPublicUrl(u).then((v) => v.href, () => null)))).filter((u): u is string => u !== null);
  if (urls.length === 0) return "";
  await log(id, `Reading ${urls.length} link${urls.length > 1 ? "s" : ""}: ${urls.join(", ")}`);

  const prefix = revision ? `r${runIndex}-` : "p";
  const reading: string[] = [];
  for (const url of urls) reading.push(await addFeed(id, runIndex, { kind: "step", label: `Reading ${new URL(url).host.replace(/^www\./, "")}`, icon: "web", status: "running", open: 1 }));
  const result = await gatherContext(urls, path.join(ws, "public/context"), prefix);
  fs.appendFileSync(path.join(ws, "context.md"), `${result.markdown}\n\n`);
  for (const note of result.notes) await log(id, note);
  // each link's note (one per link, in order) says what came of it; a page read as HTML is the next of result.pages
  await updateProject(id, (p) => {
    let pages = 0;
    for (const [i, itemId] of reading.entries()) {
      const note = result.notes[i] ?? "";
      const failed = note.indexOf(": failed (");
      const page = failed < 0 && note.includes(": “") ? result.pages[pages++] : undefined;
      const item = settleFeed(p, itemId, { error: failed >= 0, output: failed >= 0 ? `Couldn't read it: ${note.slice(failed + ": failed (".length, -1)}` : "" });
      if (!item || failed >= 0) continue;
      const images = page?.images.length ?? 0;
      item.detail = page ? [`Found “${page.title ?? page.siteName ?? "untitled"}”`, images > 0 && `${images} image${images === 1 ? "" : "s"}`].filter(Boolean).join(" · ") : note.slice(note.indexOf(": ") + 2);
    }
  });
  // what the film starts from, shown while it is made (the first page that answered)
  const page = result.pages[0];
  if (!revision && page) await patchAgent(id, { found: page });

  const pictures = result.images.length > 0 ? ` Images: ${result.images.map((i) => `public/context/${i}`).join(", ")}.` : "";
  return `Research from ${urls.join(", ")} is in context.md.${pictures}`;
}

type Session = { runner: MotionRunner; model: string; effort: "low" | "medium" | "high"; shell: boolean; film3d: boolean; narrated: boolean; portrait: boolean; run: number };

/**
 * A session without a shell: its file tools, the studio's own commands as tools (filmTools), and web research
 * (WebSearch runs at Anthropic; WebFetch only to public addresses: workspaceOnly).
 */
const FILE_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "TodoWrite", "WebSearch", "WebFetch"];

/** What a session without a shell is told, on top of CLAUDE.md and the skill (which speak of the commands). */
const NO_SHELL = [
  "# This session has no shell",
  "",
  "The studio's commands are tools here, and each returns what its command prints:",
  "- `npm run check` → the `check` tool.",
  "- `npm run stills` / `npm run stills -- <frames>` → the `stills` tool with those frames. It returns one contact-sheet image of them (left to right, top to bottom; the frames are also saved one by one, so you can Read any of them at full size); `sheet: false` returns one image per frame instead.",
  '- `node scripts/voice.mjs <name> "<text>"` → the `voice` tool with that name and text (`seed` for `--seed`).',
  "- `ls <dir>` → the `ls` tool. It follows links: use it for node_modules (e.g. `node_modules/@remotion/google-fonts` lists every font you can load), which Glob and Grep do not search.",
  "- Several changes to one file at once (what you would do with `sed` or a script) → the `multi_edit` tool, in one call.",
  "Read, write and edit files with the file tools, only inside this folder. src/, public/ and PLAN.md are yours; the rest belongs to the studio.",
  "WebSearch and WebFetch are there to learn more about the product (its features, docs, changelog) when context.md isn't enough.",
].join("\n");

/** Files a session without a shell may not change: the studio's tooling and instructions. */
const STUDIO_FILES = /^(node_modules|scripts|\.claude|\.film|package(-lock)?\.json|tsconfig\.json|CLAUDE\.md|src\/config\.ts)(\/|$)/;

const text = (value: string) => ({ type: "text" as const, text: value });

/** The ElevenLabs characters of every line scripts/voice.mjs reports it generated, on the usage ledger (what metering charges). */
function meterVoice(id: string, ws: string, output: string, ms: number) {
  for (const match of output.matchAll(/^public\/voice\/([\w-]+)\.mp3 \d+ms/gm)) {
    let line: unknown;
    try {
      const info: unknown = JSON.parse(fs.readFileSync(path.join(ws, "public", "voice", `${match[1]}.json`), "utf8"));
      line = info && typeof info === "object" && "text" in info ? info.text : undefined;
    } catch {
      continue;
    }
    if (typeof line === "string" && line) recordSpeech({ model: VOICE_MODEL, purpose: "voice line", chars: line.length, ok: true, ms, projectId: id });
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG of 8-bit RGB pixels, written with Node's zlib: the server has no image library, and its ffmpeg reads PNG. */
function pngOf(rgb: Buffer, width: number, height: number): Buffer {
  const stride = width * 3;
  // each scanline behind its filter byte (0: none)
  const lines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(lines, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(zlib.crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour RGB
  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(lines, { level: 1 })), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * One contact sheet of a round of stills: the frames left to right, top to
 * bottom, about 2000 px wide, saved beside them as sheet.jpg. Remotion's
 * bundled ffmpeg has no tiling filter, so it decodes each frame to pixels at
 * its tile size, the grid is laid out here, and ffmpeg encodes the JPEG.
 * Null when it can't be made.
 */
async function contactSheet(ws: string, files: string[], portrait: boolean): Promise<{ file: string; cols: number } | null> {
  if (files.length < 2) return null;
  const cols = Math.ceil(Math.sqrt((files.length * (portrait ? 16 : 9)) / (portrait ? 9 : 16)));
  const rows = Math.ceil(files.length / cols);
  const gap = 4;
  // the sheet's longer side about 2000 px
  const tileW = Math.floor(Math.min(portrait ? 540 : 960, 2000 / cols, ((2000 / rows) * (portrait ? 9 : 16)) / (portrait ? 16 : 9)) / 2) * 2;
  const tileH = Math.round((tileW * (portrait ? 16 : 9)) / (portrait ? 9 : 16) / 2) * 2;
  const width = cols * tileW + (cols + 1) * gap;
  const height = rows * tileH + (rows + 1) * gap;
  const out = path.join(path.dirname(path.join(ws, files[0]!)), "sheet.jpg");
  const png = out.replace(/\.jpg$/, ".png");
  try {
    const { dir, env } = mediaTools();
    const ffmpeg = path.join(dir, "ffmpeg");
    const sheet = Buffer.alloc(width * height * 3, 255);
    for (const [i, file] of files.entries()) {
      const { stdout } = await execFileAsync(ffmpeg, ["-v", "error", "-i", path.join(ws, file), "-vf", `scale=${tileW}:${tileH}`, "-f", "image2pipe", "-c:v", "rawvideo", "-pix_fmt", "rgb24", "-"], { env, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
      if (stdout.length !== tileW * tileH * 3) return null;
      const left = gap + (i % cols) * (tileW + gap);
      const top = gap + Math.floor(i / cols) * (tileH + gap);
      for (let y = 0; y < tileH; y++) stdout.copy(sheet, ((top + y) * width + left) * 3, y * tileW * 3, (y + 1) * tileW * 3);
    }
    fs.writeFileSync(png, pngOf(sheet, width, height));
    await execFileAsync(ffmpeg, ["-v", "error", "-y", "-i", png, "-q:v", "3", out], { env });
    return { file: out, cols };
  } catch {
    return null;
  } finally {
    fs.rmSync(png, { force: true });
  }
}

/** The studio's commands (check, stills, voice), run by the server for a session without a shell. */
const filmTools = (id: string, ws: string, session: Session) =>
  createSdkMcpServer({
    name: "film",
    tools: [
      tool("check", "Typecheck the video (what `npm run check` does). Returns the compiler's errors, or that there are none.", {}, async () => {
        const result = await runProcess(path.join(ws, "node_modules/.bin/tsc"), ["--noEmit"], ws);
        return { content: [text(result.code === 0 ? "No errors." : result.output.slice(-8000))] };
      }),
      tool(
        "stills",
        "Render review frames (what `npm run stills -- <frames>` does): saves them as review/rNN/fNNNN.jpg and returns one contact-sheet image of them (left to right, top to bottom). No frames: 9 spread over the video. sheet: false returns one image per frame instead.",
        { frames: z.array(z.number().int().min(0)).max(24).optional(), sheet: z.boolean().optional() },
        async ({ frames, sheet = true }) => {
          const result = await runProcess("node", ["scripts/stills.mjs", ...(frames ?? []).map(String)], ws);
          if (result.code !== 0) return { content: [text(result.output.slice(-6000))], isError: true };
          const rendered = [...result.output.matchAll(/^frame (\d+) \([^)]*\) -> (review\/r\d+\/f\d+\.jpg)$/gm)].map((m) => ({ frame: Number(m[1]), file: m[2]! }));
          const made = sheet ? await contactSheet(ws, rendered.map((r) => r.file), session.portrait) : null;
          const note = made ? `\nContact sheet ${path.relative(ws, made.file)}, ${made.cols} per row, left to right, top to bottom: frames ${rendered.map((r) => r.frame).join(", ")}.` : "";
          const images = made ? [made.file] : rendered.map((r) => path.join(ws, r.file));
          return {
            content: [
              text(`${result.output.trim()}${note}`),
              ...images.map((file) => ({ type: "image" as const, data: fs.readFileSync(file).toString("base64"), mimeType: "image/jpeg" })),
            ],
          };
        }
      ),
      tool(
        "ls",
        "List a folder inside this film's folder (what `ls -la <dir>` does), following links such as node_modules: each entry with its kind and size. `filter` keeps names containing it (case-insensitive).",
        { path: z.string().max(400).default("."), filter: z.string().max(100).optional() },
        async ({ path: dir, filter }) => {
          const where = insideWorkspace(ws, dir);
          if (where === null) return { content: [text("Only folders in this film's folder.")], isError: true };
          let entries: fs.Dirent[];
          try {
            entries = fs.readdirSync(path.join(ws, where), { withFileTypes: true });
          } catch (error) {
            return { content: [text(error instanceof Error ? error.message : String(error))], isError: true };
          }
          const wanted = entries.filter((e) => !filter || e.name.toLowerCase().includes(filter.toLowerCase()));
          const lines = wanted.slice(0, 2000).map((e) => {
            const full = path.join(ws, where, e.name);
            const stat = fs.statSync(full, { throwIfNoEntry: false });
            return stat?.isDirectory() ? `${e.name}/` : `${e.name}  ${stat?.size ?? "?"} B`;
          });
          return { content: [text(`${where || "."}: ${wanted.length} entr${wanted.length === 1 ? "y" : "ies"}${wanted.length > 2000 ? " (first 2000 shown)" : ""}\n${lines.join("\n")}`)] };
        }
      ),
      tool(
        "multi_edit",
        "Make several exact replacements in one file in one call (what a `sed` script does). Edits apply in order; each `old` must appear exactly once unless `all` is true. Nothing is written if any edit fails.",
        { path: z.string().max(400), edits: z.array(z.object({ old: z.string().min(1), new: z.string(), all: z.boolean().optional() })).min(1).max(50) },
        async ({ path: file, edits }) => {
          const where = insideWorkspace(ws, file);
          if (where === null || where === "") return { content: [text("Only files in this film's folder.")], isError: true };
          if (STUDIO_FILES.test(where)) return { content: [text("That file belongs to the studio. Change src/, public/ and PLAN.md.")], isError: true };
          let source: string;
          try {
            source = fs.readFileSync(path.join(ws, where), "utf8");
          } catch (error) {
            return { content: [text(error instanceof Error ? error.message : String(error))], isError: true };
          }
          for (const [i, edit] of edits.entries()) {
            const count = source.split(edit.old).length - 1;
            if (count === 0) return { content: [text(`Edit ${i + 1}: \`old\` not found; nothing was written.`)], isError: true };
            if (count > 1 && !edit.all) return { content: [text(`Edit ${i + 1}: \`old\` appears ${count} times; give more context or set all: true. Nothing was written.`)], isError: true };
            source = edit.all ? source.split(edit.old).join(edit.new) : source.replace(edit.old, () => edit.new);
          }
          fs.writeFileSync(path.join(ws, where), source);
          return { content: [text(`${where}: ${edits.length} edit${edits.length === 1 ? "" : "s"} applied.`)] };
        }
      ),
      ...(session.narrated
        ? [
            tool(
              "voice",
              'Generate one narration line with ElevenLabs (what `node scripts/voice.mjs <name> "<text>" [--seed n]` does): public/voice/<name>.mp3 and public/voice/<name>.json with the measured word starts.',
              { name: z.string().regex(/^[\w-]+$/).max(60), text: z.string().min(1).max(600), seed: z.number().int().min(0).optional() },
              async ({ name, text: line, seed }) => {
                const started = Date.now();
                const result = await runProcess("node", ["scripts/voice.mjs", name, line, ...(seed === undefined ? [] : ["--seed", String(seed)])], ws, undefined, stopSignal(), { ...process.env, ...voiceEnv() });
                if (result.code !== 0) return { content: [text(result.output.slice(-4000))], isError: true };
                meterVoice(id, ws, result.output, Date.now() - started);
                return { content: [text(result.output.trim())] };
              }
            ),
          ]
        : []),
    ],
  });

/** A path a tool names, inside the workspace (relative, no way out), or null. */
const insideWorkspace = (ws: string, value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const abs = path.resolve(ws, value);
  return abs === ws || abs.startsWith(ws + path.sep) ? path.relative(ws, abs) : null;
};

/**
 * For a session without a shell: its tools may touch this workspace only, and never the studio's own files;
 * WebFetch reaches public addresses only (the server makes the request).
 */
const workspaceOnly =
  (ws: string): CanUseTool =>
  async (name, input) => {
    if (name.startsWith("mcp__film__") || name === "TodoWrite" || name === "WebSearch") return { behavior: "allow", updatedInput: input };
    if (name === "WebFetch") {
      return assertPublicUrl(String(input.url ?? "")).then(
        () => ({ behavior: "allow" as const, updatedInput: input }),
        () => ({ behavior: "deny" as const, message: "Only public web addresses." })
      );
    }
    if (!["Read", "Write", "Edit", "Glob", "Grep"].includes(name)) return { behavior: "deny", message: "Not available in this session." };
    for (const key of ["file_path", "path", "notebook_path"]) {
      if (input[key] === undefined) continue;
      const where = insideWorkspace(ws, input[key]);
      if (where === null) return { behavior: "deny", message: "Only files in this film's folder." };
      if ((name === "Write" || name === "Edit") && STUDIO_FILES.test(where)) return { behavior: "deny", message: "That file belongs to the studio. Change src/, public/ and PLAN.md." };
    }
    for (const key of ["pattern", "glob"]) {
      const value = input[key];
      if (typeof value === "string" && (path.isAbsolute(value) || value.split(/[\\/]/).includes(".."))) return { behavior: "deny", message: "Only files in this film's folder." };
    }
    return { behavior: "allow", updatedInput: input };
  };

/** Runs one agent session; resolves to the turns it took. */
async function runAgent(id: string, ws: string, prompt: string, resume: string | undefined, session: Session): Promise<number> {
  const abort = new AbortController();
  const stop = stopSignal();
  const onStop = () => abort.abort();
  stop?.addEventListener("abort", onStop);
  const calls: ToolCalls = { names: new Map(), voice: new Set(), feed: new Map(), run: session.run, turns: 0 };
  const stderrTail: string[] = [];
  let syncing = Promise.resolve();
  const poll = setInterval(() => {
    syncing = syncing.then(() => syncWorkspace(id, ws)).catch(() => undefined);
  }, POLL_MS);

  try {
    const q = query({
      prompt,
      options: {
        cwd: ws,
        model: session.model,
        effort: session.effort,
        maxTurns: config.motion.maxTurns,
        resume,
        abortController: abort,
        ...(session.shell
          ? { tools: AGENT_TOOLS, permissionMode: "bypassPermissions" as const, allowDangerouslySkipPermissions: true }
          : { tools: FILE_TOOLS, mcpServers: { film: filmTools(id, ws, session) }, permissionMode: "default" as const, canUseTool: workspaceOnly(ws) }),
        settingSources: ["project"],
        systemPrompt: { type: "preset", preset: "claude_code", append: systemAppend(session) },
        env: agentEnv(session.runner, session.shell, session.narrated),
        stderr: (data) => {
          stderrTail.push(data);
          if (stderrTail.length > 40) stderrTail.shift();
        },
      },
    });
    for await (const message of q) await handleMessage(id, ws, message, calls, session.runner);
    return calls.turns;
  } catch (err) {
    if (abort.signal.aborted) throw new Stopped();
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`The film session failed: ${message}\n${stderrTail.join("").slice(-3000)}`);
  } finally {
    clearInterval(poll);
    stop?.removeEventListener("abort", onStop);
    await syncing;
    await syncWorkspace(id, ws);
  }
}

/**
 * The session's tool calls: each one's tool, the shell calls that run scripts/voice.mjs (metered once they succeed),
 * and the feed entry each call is shown on; the run the session belongs to, and its turns once it finishes.
 */
type ToolCalls = { names: Map<string, string>; voice: Set<string>; feed: Map<string, string>; run: number; turns: number };

const VOICE_COMMAND = /scripts\/voice\.mjs|npm run voice/;

async function handleMessage(id: string, ws: string, message: SDKMessage, calls: ToolCalls, runner: MotionRunner): Promise<void> {
  switch (message.type) {
    case "system": {
      if (message.subtype !== "init") return;
      await patchAgent(id, { model: message.model, sessionId: message.session_id });
      await log(id, "Session started");
      return;
    }
    case "assistant": {
      if (message.parent_tool_use_id) return;
      for (const block of message.message.content) {
        if (block.type === "text" && block.text.trim()) {
          await log(id, block.text.trim().slice(0, 2000));
          await addFeed(id, calls.run, { kind: "thought", text: block.text.trim().slice(0, THOUGHT_MAX) });
        } else if (block.type === "tool_use") {
          calls.names.set(block.id, block.name);
          const input = (block.input ?? {}) as Record<string, unknown>;
          if (block.name === "Bash" && VOICE_COMMAND.test(String(input.command ?? ""))) calls.voice.add(block.id);
          await log(id, describeTool(block.name, input, ws));
          const step = feedStepFor(block.name, input, ws);
          if (step) calls.feed.set(block.id, await addFeed(id, calls.run, step));
          // the progress shows what is happening now, in a line a viewer reads ("Animating the inbox"), on the step it belongs to
          const stage = stageForTool(block.name, input, ws);
          const line = activityFor(block.name, input, ws);
          if (stage) await setActivity(id, line ?? STAGES[stage].activity, STAGES[stage].stage);
          else if (line) await updateProject(id, (p) => void (p.activity = line));
        }
      }
      return;
    }
    case "user": {
      const content = message.message.content;
      if (typeof content === "string") return;
      for (const block of content) {
        if (block.type !== "tool_result") continue;
        const output = typeof block.content === "string" ? block.content : (block.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join("\n");
        // a line the shell recorded: billed like the voice tool's
        if (calls.voice.delete(block.tool_use_id)) meterVoice(id, ws, output, 0);
        if (block.is_error) await log(id, `${calls.names.get(block.tool_use_id) ?? "Tool"} reported an error: ${output.slice(0, 600)}`, "warn");
        const entry = calls.feed.get(block.tool_use_id);
        if (entry) {
          calls.feed.delete(block.tool_use_id);
          await updateProject(id, (p) => void settleFeed(p, entry, { error: !!block.is_error, output }));
        }
      }
      return;
    }
    case "result": {
      // cumulative for the whole session: a resumed session continues from the saved total
      await patchAgent(id, { costUsd: message.total_cost_usd, ...(message.subtype === "success" ? { summary: message.result } : {}) });
      if (runner === "api") await bill(id, message.session_id, message.modelUsage, message.duration_ms);
      calls.turns = message.num_turns;
      if (message.subtype !== "success") throw new Error(`The film session stopped: ${message.subtype}`);
      await log(id, `Finished in ${message.num_turns} turns (${Math.round(message.duration_ms / 1000)}s)`);
      // the closing summary is the chat's reply, not a thought
      const summary = message.result;
      await updateProject(id, (p) => dropSummary(p, calls.run, summary));
      return;
    }
    default:
      return;
  }
}

/**
 * A session signed in with the API is billed on the usage ledger. Its usage
 * totals are cumulative for the session (a resumed one continues from them),
 * so only what is new since the last bill is recorded.
 */
async function bill(id: string, sessionId: string, usage: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }>, ms: number) {
  const agent = agentOf(await getProject(id));
  const seen = agent.billed?.sessionId === sessionId ? agent.billed.byModel : {};
  const byModel: NonNullable<MotionAgent["billed"]>["byModel"] = { ...seen };
  for (const [model, u] of Object.entries(usage)) {
    const now = { input: u.inputTokens, output: u.outputTokens, cacheRead: u.cacheReadInputTokens, cacheWrite: u.cacheCreationInputTokens };
    const was = seen[model] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const delta = {
      inputTokens: Math.max(0, now.input - was.input),
      outputTokens: Math.max(0, now.output - was.output),
      cacheReadTokens: Math.max(0, now.cacheRead - was.cacheRead),
      cacheWriteTokens: Math.max(0, now.cacheWrite - was.cacheWrite),
    };
    byModel[model] = now;
    if (delta.inputTokens + delta.outputTokens + delta.cacheReadTokens + delta.cacheWriteTokens > 0) {
      recordTokens({ model, purpose: "motion film", usage: delta, estimated: false, ok: true, ms });
    }
  }
  await patchAgent(id, { billed: { sessionId, byModel } });
}

function rel(ws: string, p: unknown): string {
  if (typeof p !== "string") return "";
  return path.isAbsolute(p) ? path.relative(ws, p) : p;
}

function describeTool(name: string, input: Record<string, unknown>, ws: string): string {
  const file = rel(ws, input.file_path);
  switch (name) {
    case "Read": {
      const frame = /^review\/r(\d+)\/f(\d+)\./.exec(file);
      return frame ? `Looking at frame ${Number(frame[2])} (round ${Number(frame[1])})` : `Read ${file}`;
    }
    case "Write":
      return `Wrote ${file}`;
    case "Edit":
      return `Edited ${file}`;
    case "Bash":
      return `$ ${String(input.command ?? "").slice(0, 300)}`;
    case "WebFetch":
      return `Fetched ${String(input.url ?? "")}`;
    case "WebSearch":
      return `Searched “${String(input.query ?? "")}”`;
    case "Glob":
    case "Grep":
      return `Searched files for ${String(input.pattern ?? "")}`;
    case "TodoWrite":
      return "Updated checklist";
    case "mcp__film__check":
      return "Checked the code";
    case "mcp__film__stills":
      return `${Array.isArray(input.frames) && input.frames.length ? `Rendering frames ${input.frames.join(", ")}` : "Rendering frames across the film"}${input.sheet ? " as a contact sheet" : ""}`;
    case "mcp__film__voice":
      return `Recorded narration line ${String(input.name ?? "")}: ${String(input.text ?? "").slice(0, 200)}`;
    default:
      return name;
  }
}

/** A component's file name as words for a viewer: "SceneEnd" → "the end scene", "PricingCard" → "the pricing card". */
const sceneName = (file: string): string => {
  const words = path
    .basename(file)
    .replace(/\.\w+$/, "")
    .split(/(?=[A-Z])|[-_\s]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
  const scene = words.includes("scene");
  const rest = words.filter((w) => w !== "scene").join(" ");
  return scene ? `the ${rest ? `${rest} ` : ""}scene` : `the ${rest}`;
};

/** What a tool call means, in a line for the progress (null: nothing worth saying). */
function activityFor(name: string, input: Record<string, unknown>, ws: string): string | null {
  const file = rel(ws, input.file_path);
  const command = String(input.command ?? "");
  if (name === "Write" || name === "Edit") {
    if (file === "PLAN.md") return "Writing the storyboard";
    if (!file.startsWith("src/")) return null;
    const base = path.basename(file).replace(/\.\w+$/, "");
    if (base === "Video") return "Putting the film together";
    if (/narration|caption/i.test(base)) return "Timing the captions";
    if (base === "Root" || base === "index" || base === "duration") return null;
    return `Animating ${sceneName(base)}`;
  }
  if (name === "Read") {
    const frame = /^review\/r\d+\/f(\d+)\./.exec(file);
    if (frame) return `Checking the frame at ${(Number(frame[1]) / config.motion.fps).toFixed(1)} s`;
    if (file === "context.md") return "Reading what we found on your site";
    if (file.startsWith("public/context/")) return "Looking at your site's images";
    return null;
  }
  if (name === "mcp__film__voice" || (name === "Bash" && VOICE_COMMAND.test(command))) return "Recording the narration";
  if (name === "mcp__film__stills" || (name === "Bash" && /\bstills\b/.test(command))) return "Rendering frames to review";
  if (name === "mcp__film__check" || (name === "Bash" && /\bcheck\b|tsc/.test(command))) return "Checking the film for errors";
  if (name === "WebFetch") {
    try {
      return `Looking at ${new URL(String(input.url)).host.replace(/^www\./, "")}`;
    } catch {
      return null;
    }
  }
  return null;
}

/** The line a shell call to scripts/voice.mjs records: `node scripts/voice.mjs <name> "<text>"`. */
const VOICE_LINE = /voice\.mjs\s+[\w-]+\s+(["'])([\s\S]*?)\1/;

/**
 * A tool call as an entry of the film's feed (null: not worth showing, like the
 * checklist). Its label is the progress line's (activityFor) where there is
 * one, so consecutive calls on the same thing (edits of one scene, frames
 * looked at) share it and are counted on one entry.
 */
function feedStepFor(name: string, input: Record<string, unknown>, ws: string): NewFeedItem | null {
  const task = { status: "running" as const, open: 1 };
  const command = String(input.command ?? "");
  if (name === "mcp__film__voice" || (name === "Bash" && VOICE_COMMAND.test(command))) {
    const line = name === "Bash" ? (VOICE_LINE.exec(command)?.[2] ?? "") : String(input.text ?? "");
    return { kind: "narration", label: "Recording a narration line", text: line.slice(0, 600), ...task };
  }
  if (name === "mcp__film__stills" || (name === "Bash" && /\bstills\b/.test(command))) return { kind: "stills", label: "Rendering frames to review", frames: [], ...task };
  if (name === "mcp__film__check" || (name === "Bash" && /\bcheck\b|tsc/.test(command))) return { kind: "check", label: "Checking the film for errors", ...task };
  const step = (label: string, icon: Extract<NewFeedItem, { kind: "step" }>["icon"], detail?: string): NewFeedItem => ({ kind: "step", label, icon, ...(detail ? { detail } : {}), ...task });
  if (name === "Write" || name === "Edit" || name === "mcp__film__multi_edit") {
    const file = rel(ws, name === "mcp__film__multi_edit" ? input.path : input.file_path);
    const base = path.basename(file).replace(/\.\w+$/, "");
    const line = activityFor("Edit", { file_path: file }, ws);
    if (line) return step(line, file === "PLAN.md" ? "plan" : "code");
    return step(file.startsWith("src/") ? (base === "duration" ? "Setting the film's length" : "Wiring up the film") : `Editing ${file}`, "code");
  }
  if (name === "Read") {
    const file = rel(ws, input.file_path);
    if (file.startsWith("review/")) return step("Inspecting the frames", "look");
    if (file.startsWith("public/uploads/")) return step("Looking at your attached images", "look");
    if (file === "PLAN.md") return step("Reading the storyboard", "plan");
    if (file.startsWith("src/")) return step("Reading the code", "file");
    return step(activityFor(name, input, ws) ?? `Reading ${path.basename(file)}`, file.startsWith("public/context/") ? "look" : "file");
  }
  if (name === "Glob" || name === "Grep") return step("Searching the code", "search");
  if (name === "mcp__film__ls") return step("Looking through the files", "file");
  if (name === "WebSearch") return step(`Searching the web for “${String(input.query ?? "").slice(0, 120)}”`, "search");
  if (name === "WebFetch") return step(activityFor(name, input, ws) ?? "Looking at a web page", "web");
  if (name === "Bash") return step("Running a command", "run", firstLine(command, 160));
  return null;
}

function stageForTool(name: string, input: Record<string, unknown>, ws: string): keyof typeof STAGES | undefined {
  const file = rel(ws, input.file_path);
  if ((name === "Write" || name === "Edit") && file === "PLAN.md") return "planning";
  if ((name === "Write" || name === "Edit") && file.startsWith("src/")) return "building";
  if ((name === "Bash" && /\bstills\b/.test(String(input.command ?? ""))) || name === "mcp__film__stills") return "reviewing";
  if (name === "Read" && file.startsWith("review/")) return "reviewing";
  return undefined;
}

/** Picks up PLAN.md and the latest round of review frames written by the agent. */
async function syncWorkspace(id: string, ws: string): Promise<void> {
  const agent = agentOf(await getProject(id));
  const patch: Partial<MotionAgent> = {};

  const reviewDir = path.join(ws, "review");
  if (fs.existsSync(reviewDir)) {
    const rounds = fs.readdirSync(reviewDir).filter((d) => /^r\d+$/.test(d)).sort();
    const last = rounds.at(-1);
    if (last) {
      const frames = fs
        .readdirSync(path.join(reviewDir, last))
        .filter((name) => /^f\d+\.jpg$/.test(name))
        .sort()
        .map((name) => `review/${last}/${name}`);
      if (frames.join() !== agent.frames.join()) patch.frames = frames;
    }
  }

  const planFile = path.join(ws, "PLAN.md");
  if (fs.existsSync(planFile)) {
    const plan = fs.readFileSync(planFile, "utf8");
    if (plan !== agent.plan) patch.plan = plan;
  }

  if (Object.keys(patch).length > 0) await patchAgent(id, patch);
}

type ProcResult = { code: number | null; output: string };

function runProcess(
  command: string,
  args: string[],
  cwd: string,
  onLine?: (line: string) => void,
  stop: AbortSignal | undefined = stopSignal(),
  env: NodeJS.ProcessEnv = { ...process.env, ...FILM_GL }
): Promise<ProcResult> {
  let resolve!: (result: ProcResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ProcResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const child: ChildProcess = spawn(command, args, { cwd, env });
  const kill = () => child.kill("SIGTERM");
  stop?.addEventListener("abort", kill);
  let output = "";
  let pending = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    output = (output + text).slice(-20000);
    if (!onLine) return;
    pending += text;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-20000);
  });
  child.on("error", reject);
  child.on("close", (code) => {
    stop?.removeEventListener("abort", kill);
    resolve({ code, output });
  });
  return promise;
}

/** Returns the compiler output when the project does not typecheck. */
async function typecheck(ws: string): Promise<string | null> {
  const result = await runProcess(path.join(ws, "node_modules/.bin/tsc"), ["--noEmit"], ws);
  return result.code === 0 ? null : `npm run check failed:\n${result.output}`;
}

/** The published film: src/ as it was when it last passed the check. The studio plays it and an export renders it. */
const FILM_DIR = ".film";
const PUBLISHED = `${FILM_DIR}/src`;

function publishFilm(ws: string) {
  fs.rmSync(path.join(ws, PUBLISHED), { recursive: true, force: true });
  fs.cpSync(path.join(ws, "src"), path.join(ws, PUBLISHED), { recursive: true });
}

/**
 * Renders the published film to `output` (the user's export), reporting its
 * progress (0–1); stopped by `signal`. It renders in .film/, beside the
 * workspace (its public files and packages linked in), so a change being made
 * in src/ never reaches it, with the studio's current render script. Throws
 * with the render's output when it fails.
 */
export const renderMotion = async (id: string, output: string, onProgress: (progress: number) => void, signal: AbortSignal): Promise<void> => {
  const ws = workspaceOf(id);
  // a workspace restored on this server has only its own files: the sounds come back first, and src/ is the film
  installSounds(ws);
  if (!fs.existsSync(path.join(ws, PUBLISHED))) publishFilm(ws);
  const dir = path.join(ws, FILM_DIR);
  if (!fs.existsSync(path.join(dir, "node_modules"))) fs.symlinkSync(path.join(TEMPLATE, "node_modules"), path.join(dir, "node_modules"), "dir");
  // the film's public files (its sounds among them), copied (the bundler doesn't follow links inside them)
  const pub = path.join(dir, "public");
  fs.rmSync(pub, { recursive: true, force: true });
  fs.cpSync(path.join(ws, "public"), pub, { recursive: true, dereference: true });
  const result = await runProcess(
    "node",
    [path.join(TEMPLATE, "scripts/render.mjs"), output],
    dir,
    (line) => {
      if (!line.startsWith("PROGRESS ")) return;
      const parsed: unknown = JSON.parse(line.slice("PROGRESS ".length));
      if (parsed && typeof parsed === "object" && "progress" in parsed && typeof parsed.progress === "number") onProgress(parsed.progress);
    },
    signal
  );
  if (signal.aborted) throw new Error("Render stopped.");
  if (result.code !== 0) throw new Error(`Render failed: ${result.output.split("\n").filter((l) => l.trim() && !l.startsWith("PROGRESS ")).slice(-8).join("\n")}`);
};
