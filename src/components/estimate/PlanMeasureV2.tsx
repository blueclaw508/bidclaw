// ============================================================
// V2 PlanMeasure Wrapper — Bridges PlanMeasure canvas tool to
// V2 relational measurements table. Adds work area association
// dropdown + auto-populates line item quantities.
// Renders as a floating overlay accessible from Steps 1-3.
// ============================================================

import { useState, useCallback, createContext, useContext } from 'react'
import { PlanMeasure, type Measurement, type ScaleCalibration } from './PlanMeasure'
import type { V2Measurement, V2MeasurementShape, V2WorkArea, V2PlanFile } from '@/lib/types'
// lucide-react icons used inline below

// ── Floating Overlay Context ──
// Allows any step component to open the measuring tool

interface MeasureOverlayState {
  isOpen: boolean
  planUrl: string | null
  planIndex: number
  openMeasureTool: (planUrl: string, planIndex?: number) => void
  closeMeasureTool: () => void
}

const MeasureOverlayContext = createContext<MeasureOverlayState>({
  isOpen: false,
  planUrl: null,
  planIndex: 0,
  openMeasureTool: () => {},
  closeMeasureTool: () => {},
})

export function useMeasureOverlay() {
  return useContext(MeasureOverlayContext)
}

export function MeasureOverlayProvider({
  children,
  workAreas,
  plans: _plans,
  measurements,
  onSave,
  onDelete,
  onAssociate,
}: {
  children: React.ReactNode
  workAreas: V2WorkArea[]
  plans: V2PlanFile[]
  measurements: V2Measurement[]
  onSave: (meas: {
    name: string; shape: V2MeasurementShape
    area_sf?: number; linear_ft?: number; length_ft?: number; width_ft?: number
    vertices: { x: number; y: number }[]; scale_ppi?: number
    plan_index?: number; work_area_id?: string
  }) => Promise<V2Measurement | null>
  onDelete: (id: string) => Promise<void>
  onAssociate: (measurementId: string, workAreaId: string | null) => Promise<void>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [planUrl, setPlanUrl] = useState<string | null>(null)
  const [planIndex, setPlanIndex] = useState(0)

  const openMeasureTool = useCallback((url: string, index?: number) => {
    setPlanUrl(url)
    setPlanIndex(index ?? 0)
    setIsOpen(true)
  }, [])

  const closeMeasureTool = useCallback(() => {
    setIsOpen(false)
  }, [])

  return (
    <MeasureOverlayContext.Provider value={{ isOpen, planUrl, planIndex, openMeasureTool, closeMeasureTool }}>
      {children}
      {isOpen && planUrl && (
        <PlanMeasureV2Bridge
          planUrl={planUrl}
          planIndex={planIndex}
          workAreas={workAreas}
          v2Measurements={measurements}
          onSave={onSave}
          onDelete={onDelete}
          onAssociate={onAssociate}
          onClose={closeMeasureTool}
        />
      )}
    </MeasureOverlayContext.Provider>
  )
}

// ── V2 Bridge Component ──
// Converts between PlanMeasure's Measurement[] and V2 relational storage

function PlanMeasureV2Bridge({
  planUrl,
  planIndex,
  workAreas,
  v2Measurements,
  onSave,
  onDelete,
  onAssociate,
  onClose,
}: {
  planUrl: string
  planIndex: number
  workAreas: V2WorkArea[]
  v2Measurements: V2Measurement[]
  onSave: (meas: {
    name: string; shape: V2MeasurementShape
    area_sf?: number; linear_ft?: number; length_ft?: number; width_ft?: number
    vertices: { x: number; y: number }[]; scale_ppi?: number
    plan_index?: number; work_area_id?: string
  }) => Promise<V2Measurement | null>
  onDelete: (id: string) => Promise<void>
  onAssociate: (measurementId: string, workAreaId: string | null) => Promise<void>
  onClose: () => void
}) {
  // Convert V2 measurements to PlanMeasure format for rendering
  const planMeasurements: Measurement[] = v2Measurements
    .filter(m => m.plan_index === planIndex || m.plan_index === null)
    .map(m => ({
      id: m.id,
      type: (m.shape ?? 'rectangle') as Measurement['type'],
      points: (m.vertices as { x: number; y: number }[]) ?? [],
      label: m.name ?? '',
      value: m.area_sf ?? m.linear_ft ?? 0,
      unit: (m.shape === 'linear' ? 'LF' : 'SF') as Measurement['unit'],
    }))

  const [scale, setScale] = useState<ScaleCalibration | null>(null)

  // When PlanMeasure reports changes, sync to V2 storage
  const handleMeasurementsChange = useCallback(async (newMeasurements: Measurement[]) => {
    // Find added measurements (in new but not in current V2)
    const existingIds = new Set(v2Measurements.map(m => m.id))
    const added = newMeasurements.filter(m => !existingIds.has(m.id))

    // Find deleted measurements
    const newIds = new Set(newMeasurements.map(m => m.id))
    const deleted = v2Measurements.filter(m =>
      (m.plan_index === planIndex || m.plan_index === null) && !newIds.has(m.id)
    )

    // Save new measurements
    for (const m of added) {
      const isLinear = m.type === 'linear'
      await onSave({
        name: m.label,
        shape: m.type as V2MeasurementShape,
        area_sf: isLinear ? undefined : m.value,
        linear_ft: isLinear ? m.value : undefined,
        length_ft: m.type === 'rectangle' && m.points.length >= 2
          ? Math.abs(m.points[1].x - m.points[0].x) : undefined,
        width_ft: m.type === 'rectangle' && m.points.length >= 2
          ? Math.abs(m.points[1].y - m.points[0].y) : undefined,
        vertices: m.points,
        scale_ppi: scale?.pixelDistance && scale?.realDistance
          ? scale.pixelDistance / scale.realDistance : undefined,
        plan_index: planIndex,
      })
    }

    // Delete removed measurements
    for (const m of deleted) {
      await onDelete(m.id)
    }
  }, [v2Measurements, planIndex, scale, onSave, onDelete])

  return (
    <div className="fixed inset-0 z-50">
      <PlanMeasure
        imageUrl={planUrl}
        measurements={planMeasurements}
        scale={scale}
        onMeasurementsChange={handleMeasurementsChange}
        onScaleChange={setScale}
        onClose={onClose}
      />

      {/* Work Area Association Panel — overlays bottom-right of PlanMeasure sidebar */}
      {v2Measurements.length > 0 && workAreas.length > 0 && (
        <WorkAreaAssociationPanel
          measurements={v2Measurements.filter(m => m.plan_index === planIndex || m.plan_index === null)}
          workAreas={workAreas}
          onAssociate={onAssociate}
        />
      )}
    </div>
  )
}

// ── Work Area Association Panel ──

function WorkAreaAssociationPanel({
  measurements,
  workAreas,
  onAssociate,
}: {
  measurements: V2Measurement[]
  workAreas: V2WorkArea[]
  onAssociate: (measurementId: string, workAreaId: string | null) => Promise<void>
}) {
  return (
    <div className="fixed bottom-12 right-4 z-[55] w-72 rounded-xl border border-slate-600 bg-slate-800 shadow-2xl overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-700">
        <h4 className="text-xs font-semibold text-white">Apply to Work Area</h4>
      </div>
      <div className="max-h-64 overflow-y-auto p-2 space-y-1.5">
        {measurements.map(m => (
          <div key={m.id} className="flex items-center gap-2 rounded-lg bg-slate-700/50 px-2.5 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-white">{m.name || 'Unnamed'}</p>
              <p className="text-[10px] text-slate-400">
                {m.area_sf ? `${m.area_sf.toFixed(1)} SF` : ''}
                {m.linear_ft ? `${m.linear_ft.toFixed(1)} LF` : ''}
              </p>
            </div>
            <select
              value={m.work_area_id ?? ''}
              onChange={e => onAssociate(m.id, e.target.value || null)}
              className="rounded border border-slate-600 bg-slate-700 px-1.5 py-1 text-[10px] text-white outline-none focus:border-[#2563EB] max-w-[120px]"
            >
              <option value="">None</option>
              {workAreas.map(wa => (
                <option key={wa.id} value={wa.id}>{wa.name}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}
