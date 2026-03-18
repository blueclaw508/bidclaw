import { useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import type { SpecSource } from '@/lib/types'
import { Upload, FileText, ArrowRight, X, Loader2 } from 'lucide-react'

interface NewEstimateProps {
  onCreated: (estimateId: string) => void
  onCancel: () => void
}

export function NewEstimate({ onCreated, onCancel }: NewEstimateProps) {
  const { user } = useAuth()
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [jobAddress, setJobAddress] = useState('')
  const [jobCity, setJobCity] = useState('')
  const [jobState, setJobState] = useState('')
  const [jobZip, setJobZip] = useState('')
  const [_specSource] = useState<SpecSource>('site_visit')
  const [jobDescription, setJobDescription] = useState('')
  const [planFile, setPlanFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setPlanFile(file)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    setError(null)
    setSaving(true)

    try {
      let planUrl: string | null = null

      // Upload plan file if provided
      if (planFile) {
        setUploading(true)
        const ext = planFile.name.split('.').pop()
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`
        const { error: uploadErr } = await supabase.storage
          .from('plans')
          .upload(path, planFile)
        setUploading(false)
        if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)
        const { data: urlData } = supabase.storage.from('plans').getPublicUrl(path)
        planUrl = urlData.publicUrl
      }

      // Create estimate
      const { data, error: insertErr } = await supabase
        .from('bidclaw_estimates')
        .insert({
          user_id: user.id,
          client_name: clientName,
          client_email: clientEmail || null,
          job_address: jobAddress || null,
          job_city: jobCity || null,
          job_state: jobState || null,
          job_zip: jobZip || null,
          spec_source: planFile ? 'plan' : 'site_visit',
          plan_url: planUrl,
          ai_conversation: jobDescription
            ? [{ role: 'user', content: jobDescription }]
            : null,
        })
        .select('id')
        .single()

      if (insertErr) throw new Error(insertErr.message)
      onCreated(data.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create estimate'
      setError(msg)
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-blue-900">New Estimate</h2>
        <button onClick={onCancel} className="text-slate-500 hover:text-blue-900">
          <X size={24} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Client Info */}
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">
            Client Information
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium">Client Name *</label>
              <input
                required
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                placeholder="Client or company name"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium">Email</label>
              <input
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                placeholder="client@email.com"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium">Job Address</label>
              <input
                value={jobAddress}
                onChange={(e) => setJobAddress(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                placeholder="123 Main St"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">City</label>
              <input
                value={jobCity}
                onChange={(e) => setJobCity(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium">State</label>
                <input
                  value={jobState}
                  onChange={(e) => setJobState(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  placeholder="MA"
                  maxLength={2}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Zip</label>
                <input
                  value={jobZip}
                  onChange={(e) => setJobZip(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  placeholder="02101"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Job Specs — Plan Upload + Description Together */}
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">
            Job Specs
          </h3>

          {/* Plan Upload */}
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium">Upload Plan (PDF or Image)</label>
            {planFile ? (
              <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                <FileText size={20} className="text-blue-600" />
                <span className="flex-1 truncate text-sm font-medium">{planFile.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setPlanFile(null)
                    if (fileInputRef.current) fileInputRef.current.value = ''
                  }}
                  className="text-slate-500 hover:text-red-600"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 p-6 transition-colors hover:border-blue-200">
                <Upload size={28} className="text-slate-500" />
                <span className="text-sm font-medium text-slate-500">
                  Drop PDF or image here, or click to browse
                </span>
                <span className="text-xs text-slate-500/60">
                  Supports PDF, PNG, JPG
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {/* Job Description — always visible */}
          <div>
            <label className="mb-2 block text-sm font-medium">
              Job Details &amp; Notes for AI
            </label>
            <textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 resize-none"
              placeholder="Describe the work: areas involved, materials specified, special conditions, anything the AI should know when generating work areas and takeoffs..."
            />
          </div>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={saving || !clientName}
          className="flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors" style={{ background: 'linear-gradient(135deg, #1e3a5f, #2d5aa0)' }}
        >
          {saving ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              {uploading ? 'Uploading plan...' : 'Creating estimate...'}
            </>
          ) : (
            <>
              Create & Analyze with AI
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </form>
    </div>
  )
}
