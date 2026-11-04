/**
 * Narration with ElevenLabs. The film agent writes the lines and records each
 * one itself with the studio's voice script (motion-studio/template/scripts/
 * voice.mjs), as prompt-video does; this is the key, the switch and the voice
 * the server hands that script.
 */

/** "Eric": smooth, trustworthy; the voice of the studio's reference films. */
const DEFAULT_VOICE = "cjVigY5qzO86Huf0OWal";

/** The ElevenLabs key, without the spaces a pasted value often brings (a key with them is rejected as invalid). */
export const voiceKey = (): string => (process.env.ELEVENLABS_KEY ?? process.env.ELEVENLABS_API_KEY ?? "").trim();
/** ELEVENLABS_ENABLED=0 (or the older NARRATION=0) turns voice-over off, e.g. in development. */
export const voiceSwitchedOff = (): boolean => process.env.ELEVENLABS_ENABLED === "0" || process.env.ELEVENLABS_ENABLED === "false" || process.env.NARRATION === "0";
export const voiceEnabled = (): boolean => voiceKey().length > 0 && !voiceSwitchedOff();

/** The narrator's ElevenLabs voice id (ELEVENLABS_VOICE_ID, else Eric). */
export const voiceId = (): string => process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
/** The voice's name for the run prompt. */
export const voiceLabel = (): string => (voiceId() === DEFAULT_VOICE ? "Eric" : voiceId());

/** The model voice.mjs records with (eleven_v3, which performs [expression] tags): what its characters are billed as. */
export const VOICE_MODEL = "eleven_v3";
