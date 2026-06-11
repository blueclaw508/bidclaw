import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRightCircle,
  CalendarClock,
  ClipboardList,
  Send,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { StatusBadge } from '@/components/StatusBadge'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { BlurSaveInput, inlineInputClasses } from '@/components/InlineEdit'
import { ConvertLeadModal } from '@/components/leads/ConvertLeadModal'
import {
  addLeadNote,
  deleteLead,
  getLead,
  listLeadNotes,
  updateLead,
} from '@/lib/leads'
import { LEAD_STAGE_CONFIG, LEAD_STAGE_ORDER } from '@/lib/statusConfig'
import type { Lead, LeadNote, LeadStage, Project } from '@/lib/types'
import { supabase } from '@/lib/supabase'

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [lead, setLead] = useState<Lead | null>(null)
  const [notes, setNotes] = useState<LeadNote[] | null>(null)
  const [project, setProject] = useState<Pick<Project, 'id' | 'name' | 'status'> | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [convertOpen, setConvertOpen] = useState(false)
  const [confirmLost, setConfirmLost] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(async () => {
    if (!user || !id) return
    setLoading(true)
    try {
      const row = await getLead(id)
      if (!row) {
        setNotFound(true)
        return
      }
      setLead(row)
      setNotes(await listLeadNotes(id))
      if (row.project_id) {
        const { data } = await supabase
          .from('projects')
          .select('id, name, status')
          .eq('id', row.project_id)
          .maybeSingle()
        setProject((data as typeof project) ?? null)
      } else {
        setProject(null)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load lead.")
    } finally {
      setLoading(false)
    }
  }, [user, id])

  useEffect(() => {
    void load()
  }, [load])

  /** Patch the lead (DB + local state). Returns whether it succeeded. */
  const patch = useCallback(
    async (changes: Parameters<typeof updateLead>[1]): Promise<boolean> => {
      if (!lead) return false
      const previous = lead
      setLead({ ...lead, ...changes } as Lead)
      try {
        const updated = await updateLead(lead.id, changes)
        setLead(updated)
        return true
      } catch (e) {
        setLead(previous)
        toast.error(e instanceof Error ? e.message : 'Save failed.')
        return false
      }
    },
    [lead]
  )

  const handleStageChange = (target: LeadStage) => {
    if (!lead || target === lead.stage) return
    if (target === 'lost') {
      setConfirmLost(true)
      return
    }
    void patch({ stage: target }).then((ok) => {
      if (ok) toast.success(`Moved to ${LEAD_STAGE_CONFIG[target].label}.`)
    })
  }

  const handleAddNote = async () => {
    if (!lead || !noteDraft.trim()) return
    setAddingNote(true)
    try {
      const note = await addLeadNote(lead.id, noteDraft)
      setNotes((prev) => (prev ? [note, ...prev] : [note]))
      setNoteDraft('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add note.")
    } finally {
      setAddingNote(false)
    }
  }

  const handleDelete = async () => {
    if (!lead) return
    try {
      await deleteLead(lead.id)
      toast.success('Lead deleted.')
      navigate('/app/leads')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed.')
    }
  }

  if (loading && !lead) {
    return (
      <div className="rounded-xl border border-brand-border bg-white p-6 text-sm text-brand-text-muted">
        Loading lead…
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="text-lg font-bold text-rose-900">Lead not found</h2>
        <p className="mt-1 text-sm text-rose-800">
          This lead doesn't exist or belongs to a different account.
        </p>
        <Link
          to="/app/leads"
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Leads &amp; Bids
        </Link>
      </div>
    )
  }

  if (!lead) return null

  return (
    <div className="space-y-8">
      {/* Breadcrumb + header */}
      <div>
        <Link
          to="/app/leads"
          className="inline-flex items-center gap-1 text-sm font-semibold text-brand-text-muted hover:text-brand-text"
        >
          <ArrowLeft className="h-4 w-4" />
          Leads &amp; Bids
        </Link>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight text-brand-text">
              {lead.name}
            </h1>
            <StatusBadge kind="lead" value={lead.stage} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!lead.project_id && (
              <button
                type="button"
                onClick={() => setConvertOpen(true)}
                className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark"
              >
                <ArrowRightCircle className="h-4 w-4" />
                Convert to project
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-2 rounded-md border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,420px)]">
        {/* Left — contact + pipeline */}
        <div className="space-y-6">
          <section className="rounded-xl border border-brand-border bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wide text-brand-text-muted">
              Contact
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Name">
                <BlurSaveInput
                  value={lead.name}
                  onSave={(v) => {
                    if (!v.trim()) {
                      toast.error('Name is required.')
                      return
                    }
                    return patch({ name: v.trim() })
                  }}
                />
              </Field>
              <Field label="Phone">
                <BlurSaveInput
                  value={lead.phone ?? ''}
                  onSave={(v) => patch({ phone: v.trim() || null })}
                  placeholder="508-555-0123"
                />
              </Field>
              <Field label="Email">
                <BlurSaveInput
                  value={lead.email ?? ''}
                  onSave={(v) => patch({ email: v.trim() || null })}
                  placeholder="lead@example.com"
                />
              </Field>
              <Field label="Source">
                <BlurSaveInput
                  value={lead.source ?? ''}
                  onSave={(v) => patch({ source: v.trim() || null })}
                  placeholder="Referral, website…"
                />
              </Field>
              <Field label="Job address">
                <BlurSaveInput
                  value={lead.job_address ?? ''}
                  onSave={(v) => patch({ job_address: v.trim() || null })}
                  placeholder="Street address"
                />
              </Field>
              <Field label="Town">
                <BlurSaveInput
                  value={lead.town ?? ''}
                  onSave={(v) => patch({ town: v.trim() || null })}
                  placeholder="e.g. Duxbury"
                />
              </Field>
            </div>
          </section>

          <section className="rounded-xl border border-brand-border bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wide text-brand-text-muted">
              Pipeline
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Stage">
                <select
                  value={lead.stage}
                  onChange={(e) => handleStageChange(e.target.value as LeadStage)}
                  className={inlineInputClasses}
                >
                  {LEAD_STAGE_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {LEAD_STAGE_CONFIG[s].label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Follow-up date">
                <BlurSaveInput
                  type="date"
                  value={lead.follow_up_date ?? ''}
                  onSave={(v) => patch({ follow_up_date: v || null })}
                />
              </Field>
            </div>

            {project ? (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-brand-border bg-brand-surface px-4 py-3">
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <ClipboardList className="h-4 w-4 shrink-0 text-brand-text-muted" />
                  <Link
                    to={`/app/projects/${project.id}`}
                    className="truncate font-semibold text-brand-navy hover:underline"
                  >
                    {project.name}
                  </Link>
                </div>
                <StatusBadge kind="project" value={project.status} className="shrink-0" />
              </div>
            ) : (
              <p className="mt-4 text-sm text-brand-text-muted">
                Not linked to a project yet — convert when it's time to estimate.
                Proposals live on the project once converted.
              </p>
            )}
          </section>
        </div>

        {/* Right — timestamped notes */}
        <section className="rounded-xl border border-brand-border bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wide text-brand-text-muted">
            Notes
          </h2>
          <div className="mt-4 flex gap-2">
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={2}
              placeholder="Add a note — calls, site visit, anything worth remembering."
              className={inlineInputClasses}
            />
            <button
              type="button"
              onClick={() => void handleAddNote()}
              disabled={addingNote || !noteDraft.trim()}
              className="inline-flex h-fit items-center gap-1.5 self-start rounded-md bg-brand-navy px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              Add
            </button>
          </div>
          <ul className="mt-4 space-y-3">
            {notes === null && (
              <li className="text-sm text-brand-text-muted">Loading notes…</li>
            )}
            {notes && notes.length === 0 && (
              <li className="text-sm text-brand-text-muted">No notes yet.</li>
            )}
            {(notes ?? []).map((n) => (
              <li key={n.id} className="rounded-lg border border-brand-border bg-brand-surface px-4 py-3">
                <div className="flex items-center gap-1.5 text-xs text-brand-text-muted">
                  <CalendarClock className="h-3 w-3" />
                  {formatDateTime(n.created_at)}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-brand-text">{n.body}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <ConvertLeadModal
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        lead={lead}
        onConverted={(updated) => {
          setLead(updated)
          void load()
        }}
      />

      <ConfirmDialog
        open={confirmLost}
        onClose={() => setConfirmLost(false)}
        onConfirm={async () => {
          const ok = await patch({ stage: 'lost' })
          if (ok) toast.success('Moved to Lost.')
          setConfirmLost(false)
        }}
        title="Mark this lead as Lost?"
        description={`"${lead.name}" moves to Lost. You can move it back to any stage later — nothing is deleted.`}
        confirmLabel="Mark as Lost"
        tone="danger"
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete this lead?"
        description={
          lead.project_id
            ? 'The lead and its notes are deleted permanently. The linked project is NOT touched.'
            : 'The lead and its notes are deleted permanently.'
        }
        confirmLabel="Delete lead"
        tone="danger"
      />
    </div>
  )
}

/* ---------- helpers ---------- */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-brand-text-muted">
        {label}
      </span>
      {children}
    </label>
  )
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
