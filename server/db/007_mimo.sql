-- Xiaomi MiMo V2.6 Flash (OpenCode Go id "mimo-v2.6-flash") joins the model
-- picker on trial (kept off the price lists with PRICE_LIST_EXCLUDE). USD per
-- million tokens, from opencode.ai/data/xiaomi/mimo-v2-6-flash (12 Oct 2026):
-- input 0.16, output 0.32, cached read 0.004; cache writes bill as input, like
-- the other gateway models.
insert into public.model_prices (model, input, output, cache_read, cache_write, per_k_chars) values
  ('mimo-v2.6-flash', 0.16, 0.32, 0.004, null, null)
on conflict (model) do update set
  input = excluded.input, output = excluded.output, cache_read = excluded.cache_read, cache_write = excluded.cache_write;
