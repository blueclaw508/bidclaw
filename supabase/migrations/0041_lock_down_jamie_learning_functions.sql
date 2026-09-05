-- 0041 — jamie_price_book() and jamie_quantity_bias() were callable by anon.
--
-- Both are SECURITY DEFINER, both take p_user_id, and both return exactly
-- what a competitor would pay for: the unit costs a contractor actually
-- uses, and how they correct Jamie's quantities. Postgres granted EXECUTE
-- to PUBLIC on creation (0031, this morning) and Supabase exposed them as
-- RPC, so any browser holding the anon key could pass any uuid and read
-- any account's price book. Found by auditing every definer function in
-- the schema at the end of the day.
--
-- Their only caller is jamie-chat, as service_role, which bypasses grants.
revoke all on function public.jamie_price_book(uuid, integer)    from public, anon, authenticated;
revoke all on function public.jamie_quantity_bias(uuid, integer) from public, anon, authenticated;
