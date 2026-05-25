// Data layer for the company_settings table. All five Phase 2 surfaces
// (Company Info settings page, KYN settings page, wizard Step 1, wizard
// Step 2, SetupContext) read/write through these functions — no direct
// supabase calls in components.
//
// Every row is auto-created at signup via the extended handle_new_user
// trigger (or via backfill for pre-existing users), so loadCompanySettings
// always returns a row — never null on success.

import { supabase } from '@/lib/supabase'
import type {
  CompanyEquipmentRate,
  CompanyLaborType,
  CompanySettings,
} from '@/lib/types'

/**
 * MIME whitelist + size cap for logo uploads. Cap mirrors QC's
 * displayed limit ("Logo must be under 500KB") even though we store
 * in a Supabase bucket (no localStorage size pressure). Keeps PDF
 * payloads light and matches the contractor's expectation set by QC.
 */
export const LOGO_ACCEPT: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
}
export const LOGO_SIZE_CAP = 500 * 1024 // 500 KB to match QC's displayed cap

/**
 * Load the current user's company_settings row. Throws on RLS / network
 * failure; throws on missing row (which would indicate the auto-create
 * trigger didn't fire — a real bug to surface, not a soft fallback).
 */
export async function loadCompanySettings(): Promise<CompanySettings> {
  const { data, error } = await supabase
    .from('company_settings')
    .select('*')
    .single()
  if (error) {
    throw new Error(`Couldn't load company settings: ${error.message}`)
  }
  if (!data) {
    throw new Error(
      'company_settings row missing — handle_new_user trigger likely failed for this user'
    )
  }
  return data as CompanySettings
}

/**
 * Patch the current user's row. RLS scopes the UPDATE to user_id =
 * auth.uid() so we don't pass a WHERE clause explicitly. Returns the
 * fresh row for the caller to merge into local state.
 */
export async function updateCompanySettings(
  patch: Partial<CompanySettings>
): Promise<CompanySettings> {
  // Strip fields that should never be patched from the form layer.
  // user_id is RLS-enforced; the others are server-managed.
  const {
    id: _id,
    user_id: _user_id,
    created_at: _created_at,
    updated_at: _updated_at,
    ...allowed
  } = patch
  void _id
  void _user_id
  void _created_at
  void _updated_at

  // RLS guarantees we only touch the caller's row. The
  // .eq('user_id', auth.uid()) shape doesn't work directly from here
  // without an extra select first; using .neq('id', '') as a no-op
  // predicate is hacky. Cleaner: select the row first to get the id,
  // then update by id. Tradeoff: 1 extra round-trip for safety.
  const { data: current, error: selErr } = await supabase
    .from('company_settings')
    .select('id')
    .single()
  if (selErr || !current) {
    throw new Error(
      `Couldn't locate your company_settings row: ${selErr?.message ?? 'missing'}`
    )
  }
  const { data, error } = await supabase
    .from('company_settings')
    .update(allowed)
    .eq('id', current.id)
    .select()
    .single()
  if (error || !data) {
    throw new Error(
      `Couldn't save company settings: ${error?.message ?? 'no row returned'}`
    )
  }
  return data as CompanySettings
}

/**
 * Upload a logo to the company-assets bucket. Returns the storage
 * path (NOT a URL — caller stores the path and resolves via
 * getCompanyLogoUrl when displaying). Validates MIME + size at the
 * boundary — UI also validates but this is the source-of-truth
 * defense.
 */
export async function uploadCompanyLogo(file: File): Promise<string> {
  if (!LOGO_ACCEPT[file.type]) {
    throw new Error(
      'Logo must be PNG or JPG. Other file types are not supported.'
    )
  }
  if (file.size > LOGO_SIZE_CAP) {
    throw new Error('Logo must be 5 MB or smaller.')
  }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error('Not signed in.')
  }
  // Path convention: {user_id}/logo_{timestamp}.{ext}. The timestamp
  // means repeat uploads create new objects (cheap) and the user_id
  // prefix satisfies the bucket's path-prefix RLS.
  const ext = file.name.includes('.')
    ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    : file.type === 'image/png'
      ? '.png'
      : '.jpg'
  const storagePath = `${user.id}/logo_${Date.now()}${ext}`
  const { error } = await supabase.storage
    .from('company-assets')
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    })
  if (error) {
    throw new Error(`Logo upload failed: ${error.message}`)
  }
  return storagePath
}

/**
 * Resolve a logo storage path to a short-lived signed URL for display.
 * Pattern matches project-files' Open flow — 60-second TTL is enough
 * for an <img> tag to fetch and cache.
 */
export async function getCompanyLogoUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('company-assets')
    .createSignedUrl(path, 60)
  if (error || !data?.signedUrl) {
    throw new Error(
      `Couldn't generate logo URL: ${error?.message ?? 'no URL returned'}`
    )
  }
  return data.signedUrl
}

/**
 * Mark the wizard as complete. Sets setup_completed_at to now().
 * Idempotent — calling on an already-complete row updates the
 * timestamp, which is harmless.
 */
export async function markSetupComplete(): Promise<CompanySettings> {
  return updateCompanySettings({ setup_completed_at: new Date().toISOString() })
}

// ──────────────────────────────────────────────────────────────────────
// Labor types — 5 slots per user
// ──────────────────────────────────────────────────────────────────────

/**
 * Load all 5 labor type slots for the current user, ordered by
 * slot_number. RLS scopes to user; rows are auto-created by the
 * handle_new_user trigger (or backfill).
 */
export async function loadCompanyLaborTypes(): Promise<CompanyLaborType[]> {
  const { data, error } = await supabase
    .from('company_labor_types')
    .select('*')
    .order('slot_number', { ascending: true })
  if (error) {
    throw new Error(`Couldn't load labor types: ${error.message}`)
  }
  return (data ?? []) as CompanyLaborType[]
}

/**
 * Patch a labor type slot. Caller passes the row's id (looked up
 * from a prior load) to avoid an extra SELECT round-trip.
 */
export async function updateCompanyLaborType(
  id: string,
  patch: Pick<Partial<CompanyLaborType>, 'name' | 'rate_per_hour'>
): Promise<CompanyLaborType> {
  const { data, error } = await supabase
    .from('company_labor_types')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error || !data) {
    throw new Error(`Couldn't save labor type: ${error?.message ?? 'no row returned'}`)
  }
  return data as CompanyLaborType
}

// ──────────────────────────────────────────────────────────────────────
// Equipment rates — 10 slots per user
// ──────────────────────────────────────────────────────────────────────

export async function loadCompanyEquipmentRates(): Promise<CompanyEquipmentRate[]> {
  const { data, error } = await supabase
    .from('company_equipment_rates')
    .select('*')
    .order('slot_number', { ascending: true })
  if (error) {
    throw new Error(`Couldn't load equipment rates: ${error.message}`)
  }
  return (data ?? []) as CompanyEquipmentRate[]
}

export async function updateCompanyEquipmentRate(
  id: string,
  patch: Pick<Partial<CompanyEquipmentRate>, 'name' | 'rate_per_hour'>
): Promise<CompanyEquipmentRate> {
  const { data, error } = await supabase
    .from('company_equipment_rates')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error || !data) {
    throw new Error(`Couldn't save equipment rate: ${error?.message ?? 'no row returned'}`)
  }
  return data as CompanyEquipmentRate
}
