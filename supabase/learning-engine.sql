-- Jamie Learning Engine — Layer 4 Tables
-- Run in QuickCalc's Supabase SQL Editor

-- Installation patterns learned from user edits
CREATE TABLE IF NOT EXISTS bidclaw_installation_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  trigger_item text NOT NULL,
  trigger_unit text,
  learned_components jsonb NOT NULL DEFAULT '[]',
  confidence int DEFAULT 1,
  source text DEFAULT 'user_edit',
  last_updated timestamp DEFAULT now()
);

-- Edit history for every change a user makes to Jamie's suggestions
CREATE TABLE IF NOT EXISTS bidclaw_edit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  estimate_id uuid,
  work_area_id text,
  trigger_item text,
  action text,
  item_name text,
  old_value numeric,
  new_value numeric,
  created_at timestamp DEFAULT now()
);

-- RLS
ALTER TABLE bidclaw_installation_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE bidclaw_edit_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own patterns"
  ON bidclaw_installation_patterns FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users manage own edit history"
  ON bidclaw_edit_history FOR ALL
  USING (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
