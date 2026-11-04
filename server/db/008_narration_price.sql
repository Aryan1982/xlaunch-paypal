-- Narration is metered like the model calls: ElevenLabs bills 1 credit a
-- character (Eleven v3 and Multilingual v2), and the Starter plan is $5-6 a
-- month for 30,000 credits. At the ceiling, $6 / 30k characters = $0.20 per
-- 1,000 characters (Oct 2026). Before this, eleven_v3 had no row and was
-- recorded at $0, so narration was free.
insert into public.model_prices (model, input, output, cache_read, cache_write, per_k_chars) values
  ('eleven_v3', 0, 0, null, null, 0.20),
  ('eleven_multilingual_v2', 0, 0, null, null, 0.20)
on conflict (model) do update set per_k_chars = excluded.per_k_chars;
