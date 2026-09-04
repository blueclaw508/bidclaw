-- 0032 — Room for both billing intervals, and the annual price.
--
-- subscription_tier_limits shipped with ONE stripe_price_id and one
-- monthly_price_usd. Ian's Stripe account has two prices per paid tier:
--
--   BidClaw Pro                $39/mo   ·  $399/yr  (save $69)
--   BidClaw Pro + AI Jamie    $499/mo   ·  $5,588/yr (save $400)
--
-- One column cannot hold both, and hardcoding the annual id in the checkout
-- function would put pricing back in code — the exact thing the tier table
-- exists to avoid. So the existing column becomes explicitly the MONTHLY
-- one and an annual pair sits beside it.
--
-- Renaming rather than adding-and-deprecating: nothing reads
-- stripe_price_id yet (there is no Stripe code at all), so this is free
-- now and confusing forever if left.

alter table public.subscription_tier_limits
  rename column stripe_price_id to stripe_price_id_monthly;

alter table public.subscription_tier_limits
  add column if not exists stripe_price_id_annual text,
  add column if not exists annual_price_usd numeric;

comment on column public.subscription_tier_limits.stripe_price_id_monthly is
  'Stripe Price id for the MONTHLY subscription on this tier. NULL = this tier is not purchasable monthly. Checkout reads it from here so a price change is a data edit, never a deploy.';

comment on column public.subscription_tier_limits.stripe_price_id_annual is
  'Stripe Price id for the ANNUAL subscription on this tier. NULL = no annual option.';

comment on column public.subscription_tier_limits.annual_price_usd is
  'Sticker price per YEAR, for display next to the monthly figure. Purely presentational — Stripe is the source of truth for what is actually charged.';

-- The display figures Ian's Stripe products already carry. The price IDs
-- stay NULL until they are pasted in; checkout refuses a tier whose id is
-- missing rather than guessing one.
update public.subscription_tier_limits
set monthly_price_usd = 39, annual_price_usd = 399
where tier = 'pro';

update public.subscription_tier_limits
set monthly_price_usd = 499, annual_price_usd = 5588
where tier = 'pro_ai';
