import { useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import type { SpecSource } from '@/lib/types'
import { Upload, FileText, MessageSquare, ArrowRight, X, Loader2 } from 'lucide-react'

interface NewEstimateProps {
  onCreated: (estimateId: string) => void
  onCancel: () => void
}

export function NewEstimate({ onCreated, onCancel }: NewEstimateProps) {
  const { company } = useAuth()
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [jobAddress, setJobAddress] = useState('')
  const [jobCity, setJobCity] = useState('')
  const [jobState, setJobState] = useState('')
  const [jobZip, setJobZip] = useState('')
  const [specSource, setSpecSource] = useState<SpecSource>('site_visit')
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
    if (!company) return
    setError(null)
    setSaving(true)

    try {
      let planUrl: string | null = null

      // Upload plan file if provided
      if (specSource === 'plan' && planFile) {
        setUploading(true)
        const ext = planFile.name.split('.').pop()
        const path = `${company.user_id}/${crypto.randomUUID()}.${ext}`
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
        .from('estimates')
        .insert({
          company_id: company.id,
          client_name: clientName,
          client_email: clientEmail || null,
          job_address: jobAddress || null,
          job_city: jobCity || null,
          job_state: jobState || null,
          job_zip: jobZip || null,
          spec_source: specSource,
          plan_url: planUrl,
          ai_conversation: specSource === 'site_visit' && jobDescription
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
        <h2 className="text-2xl font-bold text-navy">New Estimate</h2>
        <button onClick={onCancel} className="text-muted-foreground hover:text-navy">
          <X size={24} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Client Info */}
        <div className="rounded-xl border border-border bg-white p-6">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Client Information
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium">Client Name *</label>
              <input
                required
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                placeholder="Client or company name"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium">Email</label>
              <input
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                placeholder="client@email.com"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium">Job Address</label>
              <input
                value={jobAddress}
                onChange={(e) => setJobAddress(e.target.value)}
                className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                placeholder="123 Main St"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">City</label>
              <input
                value={jobCity}
                onChange={(e) => setJobCity(e.target.value)}
                className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium">State</label>
                <input
                  value={jobState}
                  onChange={(e) => setJobState(e.target.value)}
                  className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  placeholder="MA"
                  maxLength={2}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Zip</label>
                <input
                  value={jobZip}
                  onChange={(e) => setJobZip(e.target.value)}
                  className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  placeholder="02101"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Spec Source */}
        <div className="rounded-xl border border-border bg-white p-6">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Job Specs
          </h3>

          <div className="mb-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSpecSource('plan')}
              className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-colors ${
                specSource === 'plan'
                  ? 'border-gold bg-gold/5 text-navy'
                  : 'border-border text-muted-foreground hover:border-gold/40'
              }`}
            >
              <Upload size={24} />
              <span className="text-sm font-medium">Upload Plan</span>
            </button>
            <button
              type="button"
              onClick={() => setSpecSource('site_visit')}
              className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-colors ${
                specSource === 'site_visit'
                  ? 'border-gold bg-gold/5 text-navy'
                  : 'border-border text-muted-foreground hover:border-gold/40'
              }`}
            >
              <MessageSquare size={24} />
              <span className="text-sm font-medium">Job Description</span>
            </button>
          </div>

          {specSource === 'plan' ? (
            <div>
              {planFile ? (
                <div className="flex items-center gap-3 rounded-lg border border-gold/30 bg-gold/5 p-3">
                  <FileText size={20} className="text-gold" />
                  <span className="flex-1 truncate text-sm font-medium">{planFile.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setPlanFile(null)
                      if (fileInputRef.current) fileInputRef.current.value = ''
                    }}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border p-8 transition-colors hover:border-gold/40">
                  <Upload size={32} className="text-muted-foreground" />
                  <span className="text-sm font-medium text-muted-foreground">
                    Drop PDF or image here, or click to browse
                  </span>
                  <span className="text-xs text-muted-foreground/60">
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
          ) : (
            <div>
              <label className="mb-1 block text-sm font-medium">
                Describe the job scope
              </label>
              <textarea
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                rows={6}
                className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 resize-none"
                placeholder="Describe the work to be done, areas involved, materials specified, any special conditions..."
              />
            </div>
          )}
        </div>

        {error && (
          <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={saving || !clientName}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-navy py-3 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50 transition-colors"
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
