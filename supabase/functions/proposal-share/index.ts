// proposal-share — the client's side of a shared proposal.
//
// The contractor creates a link (create_proposal_share, 0043) and hands
// the token to the client. The client has no BidClaw account and never
// will, so everything on their side comes through here: read the
// proposal, accept it with a signature, or decline it with a reason.
//
// verify_jwt is OFF because the caller has no session. The token is the
// credential: 244 random bits, one per proposal, revocable, expiring.
//
// WHAT LEAVES THIS FUNCTION. The client proposal and only the client
// proposal. Every line is collapsed to its selling price before it goes
// out — frozen unit costs, markup percentages, labor and equipment rates
// stay here. Work-area cost subtotals are zeroed. Company settings are an
// explicit column list (identity, branding, terms), never the row. The
// project's and customer's internal notes are never selected. The Summary
// format is the only one the public page renders, and the payload is
// shaped so nothing more could be rendered from it.
//
// WHAT IT WRITES. A proposal_signatures row, and on accept the proposal's
// status to Approved. That update fires enforce_send_gate like any other,
// so a link that outlived the contractor's subscription refuses cleanly.

import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

// ── Money, ported from src/lib/money.ts ─────────────────────────────
// Only the two functions the collapse needs. Keep them identical to the
// source so the client sees the same cents the contractor's screen shows.
function roundMoney(n: number): number {
  if (!Number.isFinite(n)) return 0
  const sign = n < 0 ? -1 : 1
  return (sign * Math.round(Math.abs(n) * 100 + 1e-9)) / 100
}
function lineTotal(line: {
  quantity: unknown
  frozen_unit_cost: unknown
  frozen_markup_percent: unknown
  price_override?: unknown
}): number {
  const o = line.price_override
  if (o !== undefined && o !== null && Number.isFinite(Number(o))) {
    return roundMoney(Number(o))
  }
  const q = Number(line.quantity)
  const c = Number(line.frozen_unit_cost)
  const m = Number(line.frozen_markup_percent)
  if (!Number.isFinite(q) || !Number.isFinite(c) || !Number.isFinite(m)) return 0
  return roundMoney(q * c * (1 + m / 100))
}

// ── What the client may see ─────────────────────────────────────────
const PUBLIC_SETTINGS = [
  'company_legal_name', 'owner_name',
  'company_address_line1', 'company_address_line2', 'company_address_city',
  'company_address_state', 'company_address_zip',
  'company_phone', 'company_email', 'company_website', 'company_logo_path',
  'pdf_primary_color', 'pdf_footer_text',
  'pdf_show_payment_terms', 'pdf_show_images', 'pdf_show_terms_and_conditions',
  'pdf_show_grand_total', 'pdf_show_company_name',
  'default_terms_and_conditions', 'default_payment_terms', 'default_payment_milestones',
].join(', ')

const PUBLIC_PROJECT = [
  'id', 'name', 'status', 'customer_id',
  'site_address', 'site_address_line1', 'site_address_city', 'site_address_state', 'site_address_zip',
].join(', ')

const PUBLIC_CUSTOMER = [
  'id', 'name', 'email', 'phone',
  'billing_address', 'site_address',
  'billing_address_line1', 'billing_address_city', 'billing_address_state', 'billing_address_zip',
  'site_address_line1', 'site_address_city', 'site_address_state', 'site_address_zip',
].join(', ')

const PUBLIC_PROPOSAL = [
  'id', 'project_id', 'name', 'status', 'notes', 'presented_at', 'approved_at',
  'show_grand_total', 'terms_and_conditions', 'payment_milestones',
  'lock_version', 'created_at', 'updated_at',
].join(', ')

const PUBLIC_WORK_AREA = [
  'id', 'proposal_id', 'work_area_id', 'position', 'name_override',
  'description_override', 'enabled', 'created_at', 'updated_at',
].join(', ')

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>

/** A line the client can see: label, quantity, unit, price. Nothing else. */
function publicLine(l: Row): Row {
  return {
    id: l.id,
    proposal_work_area_id: l.proposal_work_area_id,
    category: l.category,
    label: l.label,
    unit: l.unit,
    quantity: l.quantity,
    sort_order: l.sort_order,
    // The selling price rides in price_override, which lineTotal() honours
    // before it looks at cost × markup. Every cost field is zeroed.
    price_override: lineTotal(l),
    frozen_unit_cost: 0,
    frozen_markup_percent: 0,
    frozen_labor_rate: null,
    frozen_equipment_rate: null,
    frozen_kit_factor: null,
    frozen_reference_label: null,
    source_kit_id: null,
    source_kit_line_id: null,
    created_at: l.created_at,
    updated_at: l.updated_at,
  }
}

const TOKEN_RE = /^[0-9a-f]{64}$/
const SIGNATURE_PREFIX = 'data:image/png;base64,'
const SIGNATURE_MAX_BYTES = 300_000

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: Row
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const action = body.action === 'sign' ? 'sign' : 'view'
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  if (!TOKEN_RE.test(token)) {
    return json({ error: 'link_not_found', message: 'This link is not valid.' }, 404)
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // ── The link ────────────────────────────────────────────────────────
  const { data: share, error: shareErr } = await service
    .from('proposal_shares')
    .select('*')
    .eq('token', token)
    .maybeSingle()
  if (shareErr) {
    console.error('proposal-share: share lookup failed:', shareErr.message)
    return json({ error: 'server_error', message: 'Something went wrong. Try again.' }, 500)
  }
  if (!share) {
    return json({ error: 'link_not_found', message: 'This link is not valid.' }, 404)
  }
  if (share.revoked_at) {
    return json({ error: 'link_closed', message: 'This link was closed by the contractor.' }, 410)
  }
  if (new Date(share.expires_at).getTime() < Date.now()) {
    return json(
      { error: 'link_expired', message: 'This link has expired. Ask your contractor for a new one.' },
      410
    )
  }

  // ── The proposal, project, customer, contractor ─────────────────────
  const { data: proposal, error: propErr } = await service
    .from('proposals')
    .select(
      `${PUBLIC_PROPOSAL},
       proposal_work_areas (
         ${PUBLIC_WORK_AREA},
         work_areas ( id, name, description, client_description ),
         proposal_lines ( * )
       )`
    )
    .eq('id', share.proposal_id)
    .maybeSingle()
  if (propErr || !proposal) {
    console.error('proposal-share: proposal load failed:', propErr?.message)
    return json({ error: 'link_not_found', message: 'This link is not valid.' }, 404)
  }
  if (!['sent', 'approved', 'in_progress', 'completed'].includes(proposal.status)) {
    return json(
      {
        error: 'proposal_unavailable',
        message: 'This proposal is being revised. Check back with your contractor.',
      },
      409
    )
  }

  const { data: projectRow } = await service
    .from('projects')
    .select(`${PUBLIC_PROJECT}, user_id`)
    .eq('id', proposal.project_id)
    .maybeSingle()
  if (!projectRow) {
    return json({ error: 'link_not_found', message: 'This link is not valid.' }, 404)
  }
  const { user_id: ownerId, ...project } = projectRow as Row & { user_id: string }

  const [{ data: customer }, { data: settings }, { data: latest }] = await Promise.all([
    project.customer_id
      ? service.from('customers').select(PUBLIC_CUSTOMER).eq('id', project.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    service.from('company_settings').select(PUBLIC_SETTINGS).eq('user_id', ownerId).maybeSingle(),
    service
      .from('proposal_signatures')
      .select('id, decision, signer_name, signer_email, signature_data, decline_reason, signed_at')
      .eq('proposal_id', proposal.id)
      .order('signed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const companyName =
    (settings as Row | null)?.company_legal_name?.trim() || 'your contractor'

  // ── Shape the public payload ────────────────────────────────────────
  const workAreas = ((proposal as Row).proposal_work_areas ?? []).map((wa: Row) => ({
    ...wa,
    labor_subtotal: 0,
    material_subtotal: 0,
    equipment_subtotal: 0,
    subcontractor_subtotal: 0,
    other_subtotal: 0,
    proposal_lines: (wa.proposal_lines ?? []).map(publicLine),
  }))
  const publicProposal = { ...(proposal as Row), proposal_work_areas: workAreas }

  let logoUrl: string | null = null
  const logoPath = (settings as Row | null)?.company_logo_path
  if (logoPath) {
    const { data: signed } = await service.storage
      .from('company-assets')
      .createSignedUrl(logoPath, 3600)
    logoUrl = signed?.signedUrl ?? null
  }
  const publicSettings = settings ? { ...(settings as Row), company_logo_path: null } : null

  const accepted = latest?.decision === 'accepted'
  const canSign = proposal.status === 'sent' && !accepted

  // ── view ────────────────────────────────────────────────────────────
  if (action === 'view') {
    // Best-effort. A miscounted view is not worth failing the page over.
    void service
      .from('proposal_shares')
      .update({ view_count: (share.view_count ?? 0) + 1, last_viewed_at: new Date().toISOString() })
      .eq('id', share.id)
      .then(({ error }) => {
        if (error) console.warn('proposal-share: view count failed:', error.message)
      })

    return json({
      proposal: publicProposal,
      project,
      customer: customer ?? null,
      settings: publicSettings,
      logoUrl,
      signature: latest ?? null,
      canSign,
    })
  }

  // ── sign ────────────────────────────────────────────────────────────
  const decision = body.decision === 'declined' ? 'declined' : body.decision === 'accepted' ? 'accepted' : null
  if (!decision) return json({ error: 'bad_request', message: 'Choose accept or decline.' }, 400)

  const signerName = typeof body.signer_name === 'string' ? body.signer_name.trim().slice(0, 120) : ''
  if (signerName.length < 2) {
    return json({ error: 'bad_request', message: 'Type your full name.' }, 400)
  }
  const signerEmailRaw = typeof body.signer_email === 'string' ? body.signer_email.trim().toLowerCase() : ''
  const signerEmail = signerEmailRaw && signerEmailRaw.includes('@') ? signerEmailRaw.slice(0, 254) : null

  if (accepted) {
    return json(
      { error: 'already_signed', message: `This proposal was already accepted by ${latest?.signer_name}.` },
      409
    )
  }
  if (!canSign) {
    return json(
      { error: 'proposal_unavailable', message: 'This proposal is no longer open for a decision.' },
      409
    )
  }

  let signatureData: string | null = null
  let declineReason: string | null = null
  if (decision === 'accepted') {
    if (body.agree !== true) {
      return json({ error: 'bad_request', message: 'Tick the box to confirm you agree to the terms.' }, 400)
    }
    const sig = typeof body.signature_data === 'string' ? body.signature_data : ''
    if (!sig.startsWith(SIGNATURE_PREFIX) || sig.length < SIGNATURE_PREFIX.length + 100) {
      return json({ error: 'bad_request', message: 'Draw your signature in the box.' }, 400)
    }
    if (sig.length > SIGNATURE_MAX_BYTES) {
      return json({ error: 'bad_request', message: 'That signature image is too large. Clear it and sign again.' }, 400)
    }
    if (!/^[A-Za-z0-9+/=]+$/.test(sig.slice(SIGNATURE_PREFIX.length))) {
      return json({ error: 'bad_request', message: 'That signature could not be read. Clear it and sign again.' }, 400)
    }
    signatureData = sig
  } else {
    declineReason =
      typeof body.decline_reason === 'string' ? body.decline_reason.trim().slice(0, 2000) || null : null
  }

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim().slice(0, 64) || null
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 500) || null

  // One database transaction: a failed signature insert also rolls back approval.
  const { data: signature, error: sigErr } = await service.rpc('record_proposal_decision', {
    p_token: token,
    p_decision: {
      decision, signer_name: signerName, signer_email: signerEmail,
      signature_data: signatureData, decline_reason: declineReason,
      agree: body.agree === true, ip_address: ip, user_agent: ua,
    },
  })
  if (sigErr || !signature) {
    console.error('proposal-share: decision failed:', sigErr?.message)
    const unavailable = sigErr?.code === 'P0001'
    return json({
      error: unavailable ? 'proposal_unavailable' : 'server_error',
      message: unavailable
        ? 'This proposal is no longer open for a decision. Refresh the page or contact your contractor.'
        : 'Your decision could not be saved. No approval was recorded; please try again.',
    }, unavailable ? 409 : 500)
  }

  // ── The deposit invoice, the moment they sign (roadmap step 2) ──────
  // Best-effort: a failure here must not undo an acceptance the client
  // has just made. The contractor can create it by hand from the
  // Invoices tab, which says so when a signed proposal has no invoice.
  if (decision === 'accepted') {
    await createDepositInvoice(service, proposal as Row, settings as Row | null, ownerId).catch(
      (err) => console.warn('proposal-share: deposit invoice failed:', err?.message ?? err)
    )
  }

  // ── Tell the contractor (best-effort, only when email is configured) ──
  await notifyContractor({
    service,
    ownerId,
    companyEmail: (settings as Row | null)?.company_email ?? null,
    proposalName: proposal.name,
    proposalId: proposal.id,
    projectId: proposal.project_id,
    customerName: (customer as Row | null)?.name ?? signerName,
    decision,
    signerName,
    declineReason,
  }).catch((err) => console.warn('proposal-share: notify failed:', err?.message ?? err))

  return json({ ok: true, signature })
})

// The first milestone of the proposal's payment schedule, as an invoice:
// one line per enabled work area at that percent, cents reconciled so the
// lines add up to exactly the milestone of the total, each line allocated
// to its work area so the WIP schedule can read billings by area. Mirrors
// buildMilestoneLines() in src/lib/invoices.ts. Idempotent: a proposal
// that already carries a live invoice gets nothing.
async function createDepositInvoice(
  service: ReturnType<typeof createClient>,
  proposal: Row,
  settings: Row | null,
  ownerId: string
) {
  const fromProposal = Array.isArray(proposal.payment_milestones) ? proposal.payment_milestones : []
  const fromCompany = Array.isArray(settings?.default_payment_milestones)
    ? settings!.default_payment_milestones
    : []
  const schedule: Array<{ description?: string; percent?: unknown }> =
    fromProposal.length > 0
      ? fromProposal
      : fromCompany.length > 0
        ? fromCompany
        : [{ description: 'Deposit upon acceptance', percent: 50 }]
  const first = schedule[0]
  const pct = Number(first?.percent)
  if (!Number.isFinite(pct) || pct <= 0) return

  const { data: existing } = await service
    .from('invoices')
    .select('id')
    .eq('proposal_id', proposal.id)
    .neq('status', 'void')
    .limit(1)
  if (existing && existing.length > 0) return

  const areas: Row[] = (proposal.proposal_work_areas ?? []).filter((wa: Row) => wa.enabled)
  const areaTotals = areas.map((wa) =>
    roundMoney((wa.proposal_lines ?? []).reduce((s: number, l: Row) => s + lineTotal(l), 0))
  )
  const grand = roundMoney(areaTotals.reduce((s, n) => s + n, 0))
  const target = roundMoney((grand * pct) / 100)
  const label = (first?.description ?? '').toString().trim() || 'Deposit'
  const pctText = Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2).replace(/\.?0+$/, '')}%`

  const lines = areas.map((wa, i) => ({
    description: `${(wa.name_override ?? '').toString().trim() || wa.work_areas?.name || 'Work area'} — ${pctText} (${label})`,
    quantity: 1,
    unit_price: roundMoney((areaTotals[i] * pct) / 100),
    proposal_work_area_id: wa.id as string,
  }))
  const dust = roundMoney(target - roundMoney(lines.reduce((s, l) => s + l.unit_price, 0)))
  if (dust !== 0 && lines.length > 0) {
    let idx = 0
    for (let i = 1; i < lines.length; i++) if (lines[i].unit_price > lines[idx].unit_price) idx = i
    lines[idx].unit_price = roundMoney(lines[idx].unit_price + dust)
  }
  const kept = lines.filter((l) => l.unit_price !== 0)
  if (kept.length === 0) return

  const { data: inv, error: invErr } = await service
    .from('invoices')
    .insert({
      user_id: ownerId,
      project_id: proposal.project_id,
      proposal_id: proposal.id,
      milestone_label: label,
      milestone_percent: pct,
      terms: (settings?.default_payment_terms as string | null) ?? null,
    })
    .select('id')
    .single()
  if (invErr) throw new Error(invErr.message)
  const { error: lineErr } = await service.from('invoice_lines').insert(
    kept.map((l, i) => ({ invoice_id: (inv as Row).id, ...l, sort_order: i }))
  )
  if (lineErr) {
    await service.from('invoices').delete().eq('id', (inv as Row).id)
    throw new Error(lineErr.message)
  }
}

// Resend, when RESEND_API_KEY and RESEND_FROM are set. Without them this
// is a no-op and the contractor sees the result in the app instead.
async function notifyContractor(args: {
  service: ReturnType<typeof createClient>
  ownerId: string
  companyEmail: string | null
  proposalName: string
  proposalId: string
  projectId: string
  customerName: string
  decision: 'accepted' | 'declined'
  signerName: string
  declineReason: string | null
}) {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('RESEND_FROM')
  if (!apiKey || !from) return

  let to = args.companyEmail?.trim() || null
  if (!to) {
    const { data } = await args.service.auth.admin.getUserById(args.ownerId)
    to = data?.user?.email ?? null
  }
  if (!to) return

  const appUrl = (Deno.env.get('APP_URL') ?? 'https://bluebidclaw.app').replace(/\/$/, '')
  const link = `${appUrl}/app/projects/${args.projectId}/proposals/${args.proposalId}`
  const verb = args.decision === 'accepted' ? 'accepted' : 'declined'
  const subject = `${args.customerName} ${verb} "${args.proposalName}"`
  const reason =
    args.decision === 'declined' && args.declineReason
      ? `<p><strong>Reason:</strong> ${escapeHtml(args.declineReason)}</p>`
      : ''
  const html = `
    <p>${escapeHtml(args.signerName)} ${verb} <strong>${escapeHtml(args.proposalName)}</strong>.</p>
    ${reason}
    <p><a href="${link}">Open the proposal in BidClaw</a></p>
  `

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  })
  if (!res.ok) {
    console.warn('proposal-share: resend refused:', res.status, await res.text())
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
