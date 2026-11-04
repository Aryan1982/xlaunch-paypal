-- Metered credits: work holds an estimate, then is charged what it actually
-- used. The unused part of the hold comes back through credit_refund_part.

-- ---------------------------------------------------------------------------
-- Give back `p_amount` of a spend (at most what it took). Credits go back to
-- the balances they came from, subscription first, so a refund never turns
-- expiring plan credits into pack credits. Keyed like credit_refund (the
-- refund's ref is 'refund:' || spend ref): a spend is refunded once, in part
-- or in full. Returns the credits given back (0 when already refunded).
-- ---------------------------------------------------------------------------
create or replace function public.credit_refund_part(p_spend_ref text, p_amount integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  spent public.credit_ledger;
  total integer;
  back integer;
  back_sub integer;
begin
  if p_amount <= 0 then
    return 0;
  end if;
  select * into spent from public.credit_ledger where ref = p_spend_ref and kind = 'spend';
  if not found then
    return 0;
  end if;
  perform 1 from public.credit_accounts where user_id = spent.user_id for update;
  if exists (select 1 from public.credit_ledger where ref = 'refund:' || p_spend_ref) then
    return 0;
  end if;
  total := -(spent.sub_delta + spent.pack_delta);
  back := least(p_amount, total);
  back_sub := least(back, -spent.sub_delta);
  update public.credit_accounts
    set sub_credits = sub_credits + back_sub,
        pack_credits = pack_credits + (back - back_sub),
        updated_at = now()
    where user_id = spent.user_id;
  insert into public.credit_ledger (user_id, ref, kind, sub_delta, pack_delta, reason, project_id)
    values (spent.user_id, 'refund:' || p_spend_ref, 'refund', back_sub, back - back_sub, p_reason, spent.project_id);
  return back;
end;
$$;

revoke execute on function public.credit_refund_part(text, integer, text) from public, anon, authenticated;
