// Phase-1 schema mirror. Keep these in sync with
// supabase/migrations/0001_phase1_foundation.sql.
// We're intentionally NOT using generated Supabase types yet — Phase 1
// is small enough that hand-rolled types are clearer to read and easier
// to evolve. Revisit when the schema gets too big to track manually.

export type ProjectStatus =
  | 'draft'
  | 'estimating'
  | 'proposed'
  | 'approved'
  | 'in_progress'
  | 'complete'
  | 'lost'
  | 'archived'

export type WorkAreaStatus = 'draft' | 'approved' | 'in_progress' | 'complete'

export type CatalogCategory =
  | 'labor'
  | 'material'
  | 'equipment'
  | 'disposal'
  | 'design'
  | 'other'

export type ProjectFileType =
  | 'original_plan'
  | 'measured_plan'
  | 'crew_budget'
  | 'customer_proposal'
  | 'signed_proposal'
  | 'invoice'
  | 'change_order'
  | 'other'

export interface Project {
  id: string
  user_id: string
  customer_id: string | null
  name: string
  status: ProjectStatus
  site_address: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Customer {
  id: string
  user_id: string
  name: string
  email: string | null
  phone: string | null
  billing_address: string | null
  site_address: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface WorkArea {
  id: string
  project_id: string
  name: string
  description: string | null
  sequence_order: number
  status: WorkAreaStatus
  created_at: string
  updated_at: string
}

export interface CatalogItem {
  id: string
  user_id: string
  name: string
  description: string | null
  unit: string
  category: CatalogCategory
  unit_cost: number
  markup_percent: number
  needs_pricing: boolean
  active: boolean
  created_at: string
  updated_at: string
}

export interface ProjectFile {
  id: string
  project_id: string
  file_type: ProjectFileType
  file_name: string
  storage_path: string
  mime_type: string | null
  file_size_bytes: number | null
  version_number: number
  uploaded_at: string
  created_at: string
}

// ──────────────────────────────────────────────────────────────────────
// Measurements (manual measuring tool — Phase 1 Prompt 3)
// ──────────────────────────────────────────────────────────────────────
// The `measurements` table lands in 0001_phase1_foundation.sql but we
// don't read/write rows until Phase 4 (the line tool). Defined here in
// Phase 1 so MeasureView typing stays clean as later phases land.

/**
 * DB-persisted tool discriminator. Mirrors the CHECK constraint in
 * 0001_phase1_foundation.sql.
 *
 * NOT the same as MeasureToolMode below — the toolbar has a 'select'
 * mode that is purely a UI state and never reaches the database.
 */
export type MeasurementToolType =
  | 'line'
  | 'area'
  | 'count'
  | 'freehand_polyline'
  | 'freehand_drag'

/**
 * Toolbar mode in the measure UI. Includes 'select' (the pointer/idle
 * state) and 'calibrate' (Phase 3 — set scale by clicking two points)
 * which have no DB representation; 'freehand' covers both persistence
 * variants (the disambiguation between freehand_polyline and
 * freehand_drag happens at commit time, Phase 7).
 */
export type MeasureToolMode =
  | 'select'
  | 'calibrate'
  | 'line'
  | 'count'
  | 'area'
  | 'freehand'

/**
 * Real-world units the calibration UI offers. CHECK constraint in
 * 0002_page_scales.sql mirrors this list verbatim — keep them in sync.
 */
export type RealWorldUnit = 'ft' | 'in' | 'm' | 'cm' | 'yd'

/**
 * One scale calibration per (source_file, pdf_page). The two clicked
 * points are stored in PDF page units (invariant). scale_factor is
 * denormalized as real_world_distance ÷ |p2 - p1| so reads don't
 * recompute on every measurement render.
 */
export interface PageScale {
  id: string
  project_id: string
  source_file_id: string
  pdf_page_number: number
  /** [Point, Point] in PDF page units. */
  calibration_points: unknown
  real_world_distance: number
  real_world_unit: RealWorldUnit
  /** real_world_units per PDF unit. Multiply a PDF distance by this to get the real-world distance. */
  scale_factor: number
  created_at: string
  updated_at: string
}

/** A point in any coordinate space. See measureCoords.ts for which space. */
export interface Point {
  x: number
  y: number
}

/** Two-point line measurement payload — stored in PDF page units. */
export type LinePoints = readonly [Point, Point]

/**
 * Snapshot of the PDF render state, set once per page render by
 * MeasureView. The overlay canvas + hit-test + render effect all depend
 * on this — single source of truth so PDF and overlay can't desync.
 */
export interface RenderInfo {
  /** Base PDF page width in PDF user units (typically 72 dpi). */
  pdfWidth: number
  /** Base PDF page height in PDF user units. */
  pdfHeight: number
  /** CSS px per PDF unit. fitScale × pdfWidth = canvas CSS width. */
  fitScale: number
  /** Device pixel ratio used for the canvas backing store (capped at 2). */
  dpr: number
}

/**
 * `points` shape is per-tool and lives in a JSONB column. We type the
 * row's `points` as `unknown` and narrow per-tool via the parser
 * helpers in measureCoords.ts (parseLinePoints, etc.). That keeps the
 * row type simple and pushes shape validation to a single boundary.
 */
export interface Measurement {
  id: string
  project_id: string
  work_area_id: string | null
  tool_type: MeasurementToolType
  label: string | null
  points: unknown
  pdf_page_number: number
  source_file_id: string | null
  calculated_value: number | null
  calculated_unit: string | null
  scale_factor: number
  created_at: string
  updated_at: string
}

// ──────────────────────────────────────────────────────────────────────
// Company settings (Phase 2 Prompt 4 — setup wizard + Company Info + KYN)
// ──────────────────────────────────────────────────────────────────────
// Per-user business metadata + Know Your Numbers rates. 1:1 with
// profiles via user_id. Row is auto-created at signup by the extended
// handle_new_user trigger; setup_completed_at IS NULL is the wizard-
// incomplete gate (data IS NOT the gate).

/**
 * QC-aligned shape after migration 0004. Three architectural pillars:
 *
 *   1. Identity + contact (single Address field, no DBA/EIN/etc).
 *   2. PDF branding (primary color, footer, visibility toggles for
 *      each contact-info line on the rendered proposal).
 *   3. KYN multipliers (3 markups: Materials / Subs / Freight) +
 *      default Terms & Conditions.
 *
 * Labor + equipment are NOT on this table — they're normalized into
 * `company_labor_types` (5 slots) and `company_equipment_rates` (10
 * slots). See those interfaces below.
 */
export interface CompanySettings {
  id: string
  user_id: string

  // Identity + contact (Company Profile page)
  company_legal_name: string | null
  owner_name: string | null
  /** Address split for QBO compatibility — Country defaults to US, not stored. */
  company_address_line1: string | null
  company_address_line2: string | null
  company_address_city: string | null
  company_address_state: string | null  // 2-letter postal code
  company_address_zip: string | null
  company_phone: string | null
  company_email: string | null
  company_website: string | null
  /** Path inside the `company-assets` storage bucket. Signed URLs for display. */
  company_logo_path: string | null

  // PDF branding (Enter My Numbers page)
  pdf_primary_color: string | null
  pdf_footer_text: string | null
  /** PDF visibility toggles — mirror QC's three (Payment Terms / Images / T&C). */
  pdf_show_payment_terms: boolean
  pdf_show_images: boolean
  pdf_show_terms_and_conditions: boolean

  // Markups — QC has TWO (Materials / Subs). Freight was Bidclaw scope
  // creep dropped after QC source review.
  markup_materials_percent: number | null
  markup_subs_percent: number | null

  // Proposal defaults
  default_terms_and_conditions: string | null

  /** NULL = wizard incomplete. ISO timestamp once "Complete Setup" clicked. */
  setup_completed_at: string | null

  created_at: string
  updated_at: string
}

/**
 * One of 5 labor-type slots a contractor configures. Slots 1-5 are
 * always present (auto-created at signup); `name` + `rate_per_hour`
 * are nullable until the contractor fills them in.
 *
 * Architecture (Q3b): catalog labor line items reference one of these
 * 5 slots by default, but the catalog item can override the rate
 * inline. Proposals freeze the rate at creation time (Q3a).
 */
export interface CompanyLaborType {
  id: string
  user_id: string
  slot_number: number // 1..5, enforced by CHECK constraint
  name: string | null
  rate_per_hour: number | null
  created_at: string
  updated_at: string
}

/**
 * One of 10 equipment-rate slots. Same shape + pattern as
 * `CompanyLaborType` (slots 1..10 enforced by CHECK).
 */
export interface CompanyEquipmentRate {
  id: string
  user_id: string
  slot_number: number // 1..10
  name: string | null
  rate_per_hour: number | null
  created_at: string
  updated_at: string
}

/**
 * Wizard step discriminator. The wizard runs through these in order;
 * each step has its own validation gate. Step 3 (confirmation) is a
 * read-only review of what's already saved.
 */
export type WizardStep = 'company_info' | 'kyn' | 'confirmation'

/**
 * In-memory wizard view state. Form data is ALSO persisted to DB on
 * every change (single source of truth) — this just tracks UI state.
 */
export interface WizardState {
  currentStep: WizardStep
  formData: Partial<CompanySettings>
  hasUnsavedChanges: boolean
}

// ──────────────────────────────────────────────────────────────────────
// Kit library (Phase 2 Prompt 5)
// ──────────────────────────────────────────────────────────────────────
// Kits are calculation recipes. A kit has a header (name, category,
// input unit, branch scope) plus a list of kit_lines. Each kit_line
// has a factor (e.g., 0.22 Hr/SF) that gets multiplied by an input
// quantity (e.g., 1000 SF) to generate proposal line items.
//
// Kits do NOT store prices. Each line's "reference" points to ONE of
// three upstream entities:
//
//   • Labor  → company_labor_types  (rate looked up at proposal time)
//   • Equipment → company_equipment_rates
//   • Material  → catalog_items
//   • Sub / Other → no reference (placeholder line)
//
// FKs use ON DELETE SET NULL so deleting an upstream entity doesn't
// nuke the kit_line. UI surfaces a "Reference deleted — please
// re-select" warning when the FK is NULL but reference_type is set.

export type KitLineType =
  | 'Labor'
  | 'Material'
  | 'Equipment'
  | 'Sub'
  | 'Other'

export type KitLineReferenceType =
  | 'labor_type'
  | 'equipment_rate'
  | 'catalog_item'
  | 'none'

export type KitStatus = 'active' | 'archived'

export interface Kit {
  id: string
  user_id: string
  name: string
  category: string
  input_unit: string
  branch_scope: string | null
  jamie_notes: string | null
  status: KitStatus
  created_at: string
  updated_at: string
}

/**
 * One line in a kit. Polymorphic-ish reference: `reference_type`
 * tells you which of the three FK columns holds the live link.
 * Exactly zero or one FK is populated at any time (DB CHECK).
 *
 * A NULL `factor` is a valid placeholder — the contractor knows
 * something belongs here but hasn't decided the magnitude yet.
 *
 * A NULL FK with `reference_type != 'none'` means the upstream
 * entity was deleted (ON DELETE SET NULL fired). UI handles this.
 */
export interface KitLine {
  id: string
  kit_id: string
  position: number
  type: KitLineType
  display_name: string
  reference_type: KitLineReferenceType
  reference_labor_type_id: string | null
  reference_equipment_rate_id: string | null
  reference_catalog_item_id: string | null
  factor: number | null
  factor_unit: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

/** Kit detail page payload — header + ordered lines. */
export interface KitWithLines extends Kit {
  lines: KitLine[]
}

/**
 * Kit line with the upstream reference resolved (label + optional
 * unit cost). Returned by resolveKitLineReference() — used by
 * proposal generation (Prompt 6+) to price kit lines. `null` resolved
 * means the FK is NULL or the upstream lookup failed.
 */
export interface KitLineResolved extends KitLine {
  /** Resolved name from the referenced labor_type / equipment_rate / catalog_item, or the kit_line's own display_name if reference_type='none'. */
  resolved_label: string
  /** Live unit cost from the upstream entity, if applicable. NULL for placeholder/no-reference lines or when upstream is missing. */
  resolved_unit_cost: number | null
  /** True when reference_type names a kind but the FK is NULL (upstream was deleted). UI surfaces a warning. */
  reference_missing: boolean
}

// ──────────────────────────────────────────────────────────────────────
// Proposals (Phase 2 Prompt 6 — multi-work-area architecture)
// ──────────────────────────────────────────────────────────────────────
// A proposal is the client-facing deliverable that spans one or more
// work areas of a project (mix of project-linked + ad-hoc change
// orders). Each (proposal, work area) pair is a row in
// proposal_work_areas with its own denormalized 5-category subtotals
// and an `enabled` flag. proposal_lines belong to a specific
// proposal_work_area; their pricing snapshot (rates + markup) is
// FROZEN at insert so future edits to settings/catalog don't shift
// past totals (Q3a from Prompt 5 carry-fwd).
//
// Architecture decisions:
//   • Hand-rolled types (project convention).
//   • 5 categories (4 + 'other'). 'Other' uses markup_subs_percent.
//   • Multi-work-area: proposal_work_areas join table, work_area_id
//     nullable for ad-hoc, RESTRICT cascade from work_areas.
//   • Denormalized per-work-area subtotals — syncProposalWorkAreaSubtotals
//     must be called after every line CUD to prevent drift.
//   • Disabled work areas keep computing their subtotals but are
//     excluded from the proposal grand total.
//   • frozen_unit_cost is canonical for ALL calculation;
//     frozen_labor_rate + frozen_equipment_rate are pure audit fields.

export type ProposalStatus =
  | 'draft'
  | 'presented'
  | 'accepted'
  | 'declined'
  | 'completed'

export type ProposalLineCategory =
  | 'material'
  | 'labor'
  | 'equipment'
  | 'subcontractor'
  | 'other'

export interface Proposal {
  id: string
  project_id: string
  name: string
  status: ProposalStatus
  notes: string | null
  created_at: string
  updated_at: string
}

/**
 * Join row attaching one work_area to one proposal (with overrides +
 * denormalized subtotals). Multiple per proposal supported. When
 * work_area_id is NULL the row is an ad-hoc work area (change order
 * etc.) and name_override / description_override carry the labels.
 *
 * Subtotals are SNAPSHOTS kept in sync by the data layer; they must
 * be re-computed via syncProposalWorkAreaSubtotals after every line
 * insert / update / delete that affects this row.
 */
export interface ProposalWorkArea {
  id: string
  proposal_id: string
  /** NULL for ad-hoc work areas (no source project work area). */
  work_area_id: string | null
  position: number
  name_override: string | null
  description_override: string | null
  enabled: boolean
  labor_subtotal: number
  material_subtotal: number
  equipment_subtotal: number
  subcontractor_subtotal: number
  other_subtotal: number
  created_at: string
  updated_at: string
}

/**
 * Resolved view of a proposal_work_area for the editor — name +
 * description fall back to the source work_area when no override is
 * set. `lines` are the proposal_lines attached to this work area
 * ordered by sort_order.
 */
export interface ProposalWorkAreaResolved extends ProposalWorkArea {
  resolved_name: string
  resolved_description: string | null
  source_work_area: {
    id: string
    name: string
    description: string | null
  } | null
  lines: ProposalLine[]
}

/**
 * One proposal line. All `frozen_*` fields snapshot upstream pricing
 * at insert time so the proposal's totals never shift retroactively.
 *
 * Per Phase 1 decision 5: `frozen_unit_cost` is the canonical price
 * for line-total calculation, regardless of category.
 * `frozen_labor_rate` / `frozen_equipment_rate` are NULLable
 * audit-only snapshots that capture the source rate at insert time
 * for analytics/reporting. The calculation engine never reads them.
 *
 * `frozen_markup_percent` is per-line — at insert we look up the
 * matching markup from company_settings (materials → markup_materials_percent,
 * subs + other → markup_subs_percent, labor + equipment → 0) and
 * snapshot it. Calc applies this per-line, not per-category.
 *
 * Each line attributes to a proposal_work_area via
 * `proposal_work_area_id` (NOT NULL). `proposal_id` is kept as a
 * direct convenience FK — it lets "all lines for a proposal" queries
 * skip the join and double-secures the cascade from proposals.
 */
export interface ProposalLine {
  id: string
  proposal_id: string
  /** Required. The (proposal, work_area) pair this line belongs to. */
  proposal_work_area_id: string
  /** NULL for custom lines (no kit source). NULL after the source kit was deleted. */
  source_kit_id: string | null
  /** NULL for custom lines. NULL after the source kit_line was deleted. */
  source_kit_line_id: string | null
  category: ProposalLineCategory
  label: string
  unit: string
  /** Always > 0 (CHECK constraint). For kit-sourced lines: factor × inputQuantity. */
  quantity: number
  /** Canonical price for calculation. NOT NULL, >= 0. */
  frozen_unit_cost: number
  /** Audit-only snapshot of the labor rate at insert (kit-sourced labor lines). */
  frozen_labor_rate: number | null
  /** Audit-only snapshot of the equipment rate at insert (kit-sourced equipment lines). */
  frozen_equipment_rate: number | null
  /** Markup applied to this line (% — applied to lineTotal). 0 for labor/equipment. */
  frozen_markup_percent: number
  /** Audit snapshot of the kit_line factor (for kit-sourced lines). NULL for custom. */
  frozen_kit_factor: number | null
  /** Audit snapshot of the upstream entity's label at insert time. */
  frozen_reference_label: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

/**
 * Editor payload — proposal header + ordered work areas + each work
 * area's lines (grouped under it via the join). Replaces the original
 * single-work-area ProposalWithLines now that proposals span N work
 * areas.
 */
export interface ProposalWithWorkAreas extends Proposal {
  work_areas: ProposalWorkAreaResolved[]
}

/**
 * List-row payload returned by `listProposalsByProject`. Pre-
 * aggregated counts + grand total so the list page renders in a
 * single round-trip — no N+1 fetches per row. work_area_count +
 * line_count are surfaced in the metadata line ("3 areas · 14 lines").
 */
export interface ProposalListRow extends Proposal {
  work_area_count: number
  line_count: number
  grand_total: number
}

/**
 * Uncommitted, fully-resolved kit line ready to be turned into a
 * proposal_line. Returned by previewKitLines(); the preview UI lets
 * the contractor toggle `selected` and override the placeholder
 * `quantity` before committing via addLinesFromKitPreview().
 *
 * Shape mirrors ProposalLine minus the persisted server fields
 * (id / proposal_id / created_at / updated_at), with `selected` +
 * `placeholder` flags layered on for the preview UI.
 */
export interface KitPreviewLine {
  source_kit_id: string
  source_kit_line_id: string
  category: ProposalLineCategory
  label: string
  unit: string
  /**
   * factor × inputQuantity. May be 0 for placeholder lines (NULL/0
   * factor on the source kit_line). The commit step filters
   * quantity-0 lines silently.
   */
  quantity: number
  frozen_unit_cost: number
  frozen_labor_rate: number | null
  frozen_equipment_rate: number | null
  frozen_markup_percent: number
  frozen_kit_factor: number | null
  frozen_reference_label: string | null
  sort_order: number
  /** Preview UI toggle. Defaults true. Unchecked lines are dropped on commit. */
  selected: boolean
  /**
   * True when the kit_line has NULL or 0 factor, OR when the resolved
   * upstream unit cost was null. UI groups these as "Needs Input" so
   * the contractor sees the lines that require manual quantity / cost
   * entry before committing.
   */
  placeholder: boolean
}
