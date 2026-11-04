// Generates one narration line with ElevenLabs and measures when each word is spoken:
//   node scripts/voice.mjs 03-glance "[softly] Everything, at a glance."
// -> public/voice/03-glance.mp3 and public/voice/03-glance.json:
//    { text, voice, durationMs, words: [{ word, startMs, endMs }] }
// startMs is measured from the audio (loudness envelope), not trusted from the API: ElevenLabs' own
// timestamps run ~90 ms early and are often far off for the first word after an expression tag.
// The voice is the one picked for this video (NARRATION_VOICE, set by the server only when narration is
// on, together with ELEVENLABS_KEY). Option: --seed <n> (default 7) for a different take of the same line.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// eleven_v3 understands [expression] tags; these settings keep the delivery expressive but consistent.
const MODEL = "eleven_v3";
const SETTINGS = { stability: 0.5, similarity_boost: 0.8 };
/** Tags that make a sound of their own before the words (the first voiced segment is not a word). */
const SOUND_TAGS = /^\[(sighs?|laughs?|laughing|chuckles?|giggles?|gasps?|exhales?|inhales?|breathes?|clears throat|snorts?|groans?|hums?|whistles?)\]/i;
/** Voiced stretches shorter than this are breaths or release noise, not words. */
const MIN_SEGMENT_MS = 150;

const root = process.cwd();
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const [, value] = args.splice(i, 2);
  return value;
};

try {
  const seed = Number(flag("seed", "7"));
  const [name, text] = args;
  if (!name || !text || !/^[\w-]+$/.test(name)) {
    throw new Error('Usage: node scripts/voice.mjs <name> "<[tag] text>" [--seed n]');
  }
  const voice = process.env.NARRATION_VOICE;
  const key = process.env.ELEVENLABS_KEY;
  if (!voice || !key) throw new Error("Narration is off for this video; do not add a voice-over.");

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: MODEL, voice_settings: SETTINGS, seed }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = await res.json();

  const outDir = path.join(root, "public/voice");
  fs.mkdirSync(outDir, { recursive: true });
  const mp3 = path.join(outDir, `${name}.mp3`);
  fs.writeFileSync(mp3, Buffer.from(data.audio_base64, "base64"));

  // Words as ElevenLabs aligned them, with [tags] blanked out.
  const align = data.normalized_alignment ?? data.alignment;
  const chars = align.characters.join("").replace(/\[[^\]]*\]/g, (s) => " ".repeat(s.length));
  const aligned = [...chars.matchAll(/[\p{L}\p{N}'’]+/gu)].map((m) => ({
    word: m[0],
    start: align.character_start_times_seconds[m.index] * 1000,
    end: align.character_end_times_seconds[m.index + m[0].length - 1] * 1000,
  }));

  // Voiced segments from a 10 ms loudness envelope. Remotion's bundled ffmpeg has no raw-PCM muxer, so
  // decode to a 16 kHz mono WAV on stdout and read the samples after its "data" chunk header.
  const wav = execFileSync(
    path.join(root, "node_modules/.bin/remotion"),
    ["ffmpeg", "-v", "error", "-i", mp3, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const dataAt = wav.indexOf("data", 12) + 8;
  const pcm = wav.subarray(dataAt, dataAt + Math.floor((wav.length - dataAt) / 2) * 2);
  const samples = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
  const hop = 160;
  const rms = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let sum = 0;
    for (let j = i; j < i + hop; j++) sum += (samples[j] / 32768) ** 2;
    rms.push(Math.sqrt(sum / hop) + 1e-9);
  }
  const peak = Math.max(...rms);
  const voiced = rms.map((r) => 20 * Math.log10(r / peak) > -26);
  const segments = [];
  for (let i = 0; i < voiced.length; ) {
    if (!voiced[i]) {
      i++;
      continue;
    }
    let j = i;
    // Dips shorter than 150 ms are inside a phrase (between words or syllables), not pauses.
    while (j < voiced.length && (voiced[j] || voiced.slice(j, j + 15).some(Boolean))) j++;
    if ((j - i) * 10 >= MIN_SEGMENT_MS) segments.push({ start: i * 10, end: j * 10 });
    i = j;
  }
  // A sound tag (a sigh, a laugh) makes the first voiced stretch; the words start after it.
  if (SOUND_TAGS.test(text.trim()) && segments.length > 1) segments.shift();

  // The audio decides when words start; ElevenLabs' alignment is too rough for that (it gives silent
  // tags time and squeezes the first word) but its gaps say where the pauses fall. Split the words into
  // one group per voiced segment at the largest alignment gaps, start each group exactly at its
  // segment, and spread the group's words over the segment by length.
  const groups = Math.max(1, Math.min(segments.length, aligned.length));
  const breaks = aligned
    .slice(1)
    .map((w, i) => ({ at: i + 1, gap: w.start - aligned[i].end }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, groups - 1)
    .map((b) => b.at)
    .sort((a, b) => a - b);
  const words = [];
  [0, ...breaks].forEach((from, g) => {
    const to = breaks[g] ?? aligned.length;
    const seg = segments[g] ?? { start: 0, end: samples.length / 16 };
    const group = aligned.slice(from, to);
    const weight = group.reduce((sum, w) => sum + w.word.length + 1, 0);
    let used = 0;
    for (const w of group) {
      const share = (w.word.length + 1) / weight;
      const start = seg.start + (used / weight) * (seg.end - seg.start);
      used += w.word.length + 1;
      words.push({ word: w.word, startMs: Math.round(start), endMs: Math.round(start + share * (seg.end - seg.start)) });
    }
  });
  const durationMs = Math.round((samples.length / 16000) * 1000);

  const info = { text, voice, durationMs, words };
  fs.writeFileSync(path.join(outDir, `${name}.json`), `${JSON.stringify(info, null, 2)}\n`);
  console.log(`public/voice/${name}.mp3 ${durationMs}ms  ${words.map((w) => `${w.word}@${w.startMs}`).join(" ")}`);
} catch (err) {
  console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
