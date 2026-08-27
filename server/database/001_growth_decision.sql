BEGIN;

CREATE TABLE IF NOT EXISTS product_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active',
  target_metric varchar(64) NOT NULL DEFAULT 'cpa',
  channel varchar(32) NOT NULL DEFAULT 'facebook',
  account_id varchar(120),
  data_delay_minutes integer NOT NULL DEFAULT 60,
  skill_version varchar(32) NOT NULL DEFAULT 'v0.1.0',
  doris_source varchar(255),
  thresholds jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at TIMESTAMP(3) WITH TIME ZONE,
  _created_at TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (
    CASE
      WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
      ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile
    END
  ),
  _updated_at TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT (
    CASE
      WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
      ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile
    END
  )
);

COMMENT ON COLUMN product_profile.thresholds IS
  '@type { minSpend?: number; minConversions?: number; cpaDeviationPct?: number; roasDeviationPct?: number }';
ALTER TABLE product_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_policy ON product_profile TO service_role USING (true);
CREATE POLICY "修改全部数据" ON product_profile AS PERMISSIVE FOR ALL TO authenticated
  USING (current_setting('app.user_id'::text) = ANY (ARRAY[]::text[]));
CREATE POLICY "查看全部数据" ON product_profile AS PERMISSIVE FOR SELECT TO authenticated USING (
  current_setting('app.user_id'::text) = ((_created_by).user_id)::text
);
CREATE POLICY "修改本人数据" ON product_profile AS PERMISSIVE FOR ALL TO authenticated USING (
  current_setting('app.user_id'::text) = ((_created_by).user_id)::text
) WITH CHECK (
  current_setting('app.user_id'::text) = ((_created_by).user_id)::text
);
CREATE INDEX IF NOT EXISTS idx_product_profile_status ON product_profile(status);

CREATE TABLE IF NOT EXISTS decision_case (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  anomaly_type varchar(64) NOT NULL,
  severity varchar(24) NOT NULL DEFAULT 'medium',
  status varchar(32) NOT NULL DEFAULT 'pending',
  channel varchar(32) NOT NULL DEFAULT 'facebook',
  campaign_id varchar(120),
  campaign_name varchar(255),
  adset_id varchar(120),
  adset_name varchar(255),
  audience_id varchar(120),
  audience_name varchar(255),
  ad_id varchar(120),
  ad_name varchar(255),
  creative_id varchar(120),
  creative_name varchar(255),
  target_metric varchar(64) NOT NULL,
  current_value numeric(18, 4),
  baseline_value numeric(18, 4),
  deviation_pct numeric(10, 2),
  evidence text NOT NULL,
  root_cause text NOT NULL,
  confidence numeric(5, 2) NOT NULL DEFAULT 0,
  recommendation text NOT NULL,
  recommended_action jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_impact text NOT NULL,
  risk_note text,
  decision_reason text,
  decided_by varchar(120),
  decided_at TIMESTAMP(3) WITH TIME ZONE,
  executed_at TIMESTAMP(3) WITH TIME ZONE,
  observation_ends_at TIMESTAMP(3) WITH TIME ZONE,
  result_classification varchar(32),
  actual_change_pct numeric(10, 2),
  actual_result text,
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  _created_at TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (
    CASE
      WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
      ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile
    END
  ),
  _updated_at TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT (
    CASE
      WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
      ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile
    END
  )
);

COMMENT ON COLUMN decision_case.recommended_action IS
  '@type { actionType?: string; targetLevel?: string; targetId?: string; changePct?: number; parameters?: Record<string, string | number | boolean> }';
COMMENT ON COLUMN decision_case.source_snapshot IS
  '@type { dataUpdatedAt?: string; spend?: number; conversions?: number; attributionWindow?: string; dimensions?: Record<string, string> }';
ALTER TABLE decision_case ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_policy ON decision_case TO service_role USING (true);
CREATE POLICY "修改全部数据" ON decision_case AS PERMISSIVE FOR ALL TO authenticated
  USING (current_setting('app.user_id'::text) = ANY (ARRAY[]::text[]));
CREATE POLICY "查看全部数据" ON decision_case AS PERMISSIVE FOR SELECT TO authenticated USING (
  current_setting('app.user_id'::text) = ((_created_by).user_id)::text
);
CREATE POLICY "修改本人数据" ON decision_case AS PERMISSIVE FOR ALL TO authenticated USING (
  current_setting('app.user_id'::text) = ((_created_by).user_id)::text
) WITH CHECK (
  current_setting('app.user_id'::text) = ((_created_by).user_id)::text
);
CREATE INDEX IF NOT EXISTS idx_decision_case_product ON decision_case(product_id);
CREATE INDEX IF NOT EXISTS idx_decision_case_status ON decision_case(status);
CREATE INDEX IF NOT EXISTS idx_decision_case_created ON decision_case(_created_at DESC);

CREATE TABLE IF NOT EXISTS decision_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  action varchar(64) NOT NULL,
  actor varchar(120),
  detail text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  _created_at TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (
    CASE
      WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
      ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile
    END
  ),
  _updated_at TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT (
    CASE
      WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
      ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile
    END
  )
);

COMMENT ON COLUMN decision_activity.metadata IS
  '@type { previousStatus?: string; nextStatus?: string; source?: string; requestId?: string }';
ALTER TABLE decision_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_policy ON decision_activity TO service_role USING (true);
CREATE POLICY "修改全部数据" ON decision_activity AS PERMISSIVE FOR ALL TO authenticated
  USING (current_setting('app.user_id'::text) = ANY (ARRAY[]::text[]));
CREATE POLICY "查看全部数据" ON decision_activity AS PERMISSIVE FOR SELECT TO authenticated USING (
  current_setting('app.user_id'::text) = ((_created_by).user_id)::text
);
CREATE POLICY "修改本人数据" ON decision_activity AS PERMISSIVE FOR ALL TO authenticated USING (
  current_setting('app.user_id'::text) = ((_created_by).user_id)::text
) WITH CHECK (
  current_setting('app.user_id'::text) = ((_created_by).user_id)::text
);
CREATE INDEX IF NOT EXISTS idx_decision_activity_case ON decision_activity(case_id, _created_at DESC);

COMMIT;
