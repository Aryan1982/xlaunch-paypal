-- Claude Haiku 5.5 joins the model picker. USD per million tokens, from
-- platform.claude.com/docs/en/about-claude/pricing (12 Oct 2026), the rate for
-- prompts up to 100k tokens (over that it is 5x; our prompts stay well under).
-- Cache writes are the 5-minute rate.
insert into public.model_prices (model, input, output, cache_read, cache_write, per_k_chars) values
  ('claude-haiku-5-5', 0.10, 0.50, 0.01, 0.125, null)
on conflict (model) do update set
  input = excluded.input, output = excluded.output, cache_read = excluded.cache_read, cache_write = excluded.cache_write;
