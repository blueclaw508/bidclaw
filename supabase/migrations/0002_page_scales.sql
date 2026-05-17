-- ============================================================
-- 0002_page_scales.sql
-- ============================================================
-- Phase 1 Prompt 3, Phase 3: scale calibration storage.
--
-- One row per (source_file_id, pdf_page_number). The contractor picks
-- two points on the plan and tells us the real-world distance between
-- them; we store the points (in PDF page units) and a denormalized
-- scale_factor (real_world_units per PDF unit). Phase 4's line tool
-- multiplies PDF-unit measurements by scale_factor to display
-- real-world distances.
--
-- Recalibration of an already-calibrated page is a normal upsert
-- (ON CONFLICT (source_file_id, pdf_page_number) DO UPDATE).

CREATE TABLE public.page_scales (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_file_id       UUID NOT NULL REFERENCES public.project_files(id) ON DELETE CASCADE,
  pdf_page_number      INTEGER NOT NULL DEFAULT 1
                       CHECK (pdf_page_number >= 1),
  -- [Point, Point] in PDF page units. JSONB so it composes with the
  -- existing parseLinePoints-style parsers in measureCoords.ts.
  calibration_points   JSONB NOT NULL,
  real_world_distance  NUMERIC(12, 4) NOT NULL
                       CHECK (real_world_distance > 0),
  real_world_unit      TEXT NOT NULL
                       CHECK (real_world_unit IN ('ft','in','m','cm','yd')),
  -- Denormalized: real_world_distance / pdf_distance. Stored so reads
  -- don't have to recompute on every measurement render.
  scale_factor         NUMERIC(12, 6) NOT NULL
                       CHECK (scale_factor > 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One scale per page per file. Upserts target this constraint.
  UNIQUE (source_file_id, pdf_page_number)
);

CREATE TRIGGER page_scales_set_updated_at BEFORE UPDATE ON public.page_scales
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_page_scales_project_id     ON public.page_scales(project_id);
CREATE INDEX idx_page_scales_source_file_id ON public.page_scales(source_file_id);

ALTER TABLE public.page_scales ENABLE ROW LEVEL SECURITY;

-- RLS chain identical to measurements: scale rows are visible/writable
-- by the project owner only.
CREATE POLICY "page_scales_select_own" ON public.page_scales FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = page_scales.project_id AND p.user_id = auth.uid()));

CREATE POLICY "page_scales_insert_own" ON public.page_scales FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = page_scales.project_id AND p.user_id = auth.uid()));

CREATE POLICY "page_scales_update_own" ON public.page_scales FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = page_scales.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = page_scales.project_id AND p.user_id = auth.uid()));

CREATE POLICY "page_scales_delete_own" ON public.page_scales FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = page_scales.project_id AND p.user_id = auth.uid()));
