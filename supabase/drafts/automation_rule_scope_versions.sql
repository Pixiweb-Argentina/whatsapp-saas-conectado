-- ============================================================
-- DRAFT (F4-T3.1). NOT APPLIED.
--
-- This file lives outside supabase/migrations/ on purpose: `supabase db push`
-- only reads that folder, so nothing here can reach a database by accident.
-- To ship it: review, copy it to supabase/migrations/<version>_automation_rule_scope_versions.sql
-- with a version newer than the latest migration, then apply. The app code
-- (rule-schema, form, rule-cap, list) changes in the same delivery, after it.
--
-- What it adds:
--   1. automation_rules.priority: lowest wins between comment rules that match
--      the same comment (then lowest id). v1 rules keep firing all together,
--      as today; priority only orders them in the list.
--   2. Scope on automation_rules: channel, connection_id (the account) and
--      source_type. v1 rules stay WhatsApp-wide; a comment rule is always bound
--      to one Instagram account and the comment source.
--   3. trigger_type 'comment_keyword', allowed only with that Instagram scope.
--      No v1 trigger gains a new channel (US-012 AC3: nothing unimplemented
--      turns on).
--   4. automation_rule_versions: immutable published versions (conditions +
--      steps). A comment rule can only be enabled pointing at one.
--   5. automation_runs.rule_version_id: which version a run executed.
--
-- What it does NOT add, and why:
--   - A second rules table for comments: one table keeps one list, one cap,
--     one permission path and one place where the order is decided.
--   - A `status` column: `enabled` + `paused_reason` already say it. A second
--     column would be two truths that can disagree.
--   - private_reply_claims: already exists (20261011010958) as
--     private.private_reply_claims, one reservation per comment.
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- 1. priority
-- ──────────────────────────────────────────────────────────

ALTER TABLE public.automation_rules
  ADD COLUMN IF NOT EXISTS priority INTEGER;

-- Existing rules keep the order the list shows today (created_at, then id),
-- spaced by 10 so a rule can be placed between two without renumbering.
-- The backfill is not an edit by anyone, so updated_at stays as it was.
ALTER TABLE public.automation_rules DISABLE TRIGGER trg_automation_rules_updated_at;
UPDATE public.automation_rules r
   SET priority = o.rn * 10
  FROM (
    SELECT id, row_number() OVER (PARTITION BY workspace_id ORDER BY created_at, id) AS rn
      FROM public.automation_rules
  ) o
 WHERE r.id = o.id
   AND r.priority IS NULL;
ALTER TABLE public.automation_rules ENABLE TRIGGER trg_automation_rules_updated_at;

-- A rule inserted without a priority (today's v1 form) goes last in its
-- workspace. Two concurrent inserts may tie; the tie breaks by id.
CREATE OR REPLACE FUNCTION public.set_automation_rule_priority()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.priority IS NULL THEN
    SELECT COALESCE(MAX(r.priority), 0) + 10
      INTO NEW.priority
      FROM public.automation_rules r
     WHERE r.workspace_id = NEW.workspace_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_automation_rules_priority ON public.automation_rules;
CREATE TRIGGER trg_automation_rules_priority
  BEFORE INSERT ON public.automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_automation_rule_priority();

ALTER TABLE public.automation_rules
  ALTER COLUMN priority SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.automation_rules'::regclass
       AND conname = 'ck_automation_rules_priority_range'
  ) THEN
    ALTER TABLE public.automation_rules
      ADD CONSTRAINT ck_automation_rules_priority_range
      CHECK (priority BETWEEN 0 AND 1000000);
  END IF;
END
$$;

-- ──────────────────────────────────────────────────────────
-- 2. Scope: channel, account, source
-- ──────────────────────────────────────────────────────────

ALTER TABLE public.automation_rules
  ADD COLUMN IF NOT EXISTS channel public.conversation_channel NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS connection_id UUID,
  ADD COLUMN IF NOT EXISTS source_type TEXT;

-- NO ACTION, not CASCADE or SET NULL: disconnecting an account must never
-- erase a rule's history, nor turn an account rule into a workspace-wide one.
-- NO ACTION (checked at the end of the statement) still lets a workspace
-- deletion cascade to both the rule and the connection.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.automation_rules'::regclass
       AND conname = 'fk_automation_rules_connection_same_workspace'
  ) THEN
    ALTER TABLE public.automation_rules
      ADD CONSTRAINT fk_automation_rules_connection_same_workspace
      FOREIGN KEY (workspace_id, connection_id, channel)
      REFERENCES public.channel_connections (workspace_id, id, channel);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.automation_rules'::regclass
       AND conname = 'ck_automation_rules_source_type'
  ) THEN
    ALTER TABLE public.automation_rules
      ADD CONSTRAINT ck_automation_rules_source_type
      CHECK (source_type IN ('direct_message', 'comment'));
  END IF;
END
$$;

-- ──────────────────────────────────────────────────────────
-- 3. comment_keyword trigger, guarded by its scope
-- ──────────────────────────────────────────────────────────

ALTER TABLE public.automation_rules
  DROP CONSTRAINT IF EXISTS automation_rules_trigger_type_check;
ALTER TABLE public.automation_rules
  ADD CONSTRAINT automation_rules_trigger_type_check
  CHECK (trigger_type IN (
    'first_message', 'inactivity_24h', 'window_closing', 'handoff_requested',
    'lead_qualified', 'keyword_match', 'appointment_upcoming', 'comment_keyword'
  ));

-- A comment rule's steps live in its version, so it has no v1 action.
-- Every v1 rule keeps its action_type exactly as before.
ALTER TABLE public.automation_rules
  ALTER COLUMN action_type DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.automation_rules'::regclass
       AND conname = 'ck_automation_rules_scope'
  ) THEN
    ALTER TABLE public.automation_rules
      ADD CONSTRAINT ck_automation_rules_scope
      CHECK (
        (trigger_type = 'comment_keyword'
          AND channel = 'instagram'
          AND source_type = 'comment'
          AND connection_id IS NOT NULL)
        OR
        (trigger_type <> 'comment_keyword'
          AND channel = 'whatsapp'
          AND source_type IS NULL
          AND connection_id IS NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.automation_rules'::regclass
       AND conname = 'ck_automation_rules_action_by_trigger'
  ) THEN
    ALTER TABLE public.automation_rules
      ADD CONSTRAINT ck_automation_rules_action_by_trigger
      CHECK ((trigger_type = 'comment_keyword') = (action_type IS NULL));
  END IF;
END
$$;

-- The comment matcher reads the enabled rules of one account in priority order.
CREATE INDEX IF NOT EXISTS idx_automation_rules_comment_match
  ON public.automation_rules (workspace_id, connection_id, priority, id)
  WHERE enabled AND trigger_type = 'comment_keyword';

-- ──────────────────────────────────────────────────────────
-- 4. automation_rule_versions — immutable published versions
-- ──────────────────────────────────────────────────────────

-- No direct FK to workspaces: the composite FK to automation_rules already
-- pins the workspace, and a version is removed only together with its rule.
CREATE TABLE IF NOT EXISTS public.automation_rule_versions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             UUID NOT NULL,
  rule_id                  UUID NOT NULL,
  version                  INTEGER NOT NULL CHECK (version > 0),
  condition_schema_version INTEGER NOT NULL DEFAULT 1 CHECK (condition_schema_version > 0),
  -- { keywords, postIds, foldAccents, ... } validated by the app's Zod schema.
  conditions               JSONB NOT NULL CHECK (jsonb_typeof(conditions) = 'object'),
  -- 1..10 steps; CASE so jsonb_array_length never sees a non-array.
  steps                    JSONB NOT NULL CHECK (
                             CASE WHEN jsonb_typeof(steps) = 'array'
                                  THEN jsonb_array_length(steps) BETWEEN 1 AND 10
                                  ELSE false
                             END
                           ),
  created_by               UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_automation_rule_versions_rule_version UNIQUE (workspace_id, rule_id, version),
  CONSTRAINT uq_automation_rule_versions_rule_id UNIQUE (workspace_id, rule_id, id),
  CONSTRAINT uq_automation_rule_versions_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_automation_rule_versions_rule_same_workspace
    FOREIGN KEY (workspace_id, rule_id)
    REFERENCES public.automation_rules (workspace_id, id) ON DELETE CASCADE
);

-- A published version never changes. Two exceptions, both from the database
-- itself: a deleted user's authorship is erased (ON DELETE SET NULL), and the
-- version goes away when its rule is deleted (the cascade runs after the rule
-- row is gone, so the lookup below no longer finds it).
CREATE OR REPLACE FUNCTION public.guard_automation_rule_version_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.created_by IS NULL
       AND OLD.created_by IS NOT NULL
       AND (to_jsonb(NEW) - 'created_by') = (to_jsonb(OLD) - 'created_by') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'AUTOMATION_RULE_VERSION_IMMUTABLE'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.automation_rules r
     WHERE r.workspace_id = OLD.workspace_id
       AND r.id = OLD.rule_id
  ) THEN
    RAISE EXCEPTION 'AUTOMATION_RULE_VERSION_IMMUTABLE'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_automation_rule_versions_immutable ON public.automation_rule_versions;
CREATE TRIGGER trg_automation_rule_versions_immutable
  BEFORE UPDATE OR DELETE ON public.automation_rule_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_automation_rule_version_immutable();

ALTER TABLE public.automation_rule_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ws members read automation rule versions" ON public.automation_rule_versions;
CREATE POLICY "ws members read automation rule versions" ON public.automation_rule_versions
  FOR SELECT USING (workspace_id IN (SELECT auth_workspace_ids()));

-- Versions are published only by the server (service_role), like the rules.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.automation_rule_versions FROM anon, authenticated;

-- ──────────────────────────────────────────────────────────
-- 5. The rule's active version
-- ──────────────────────────────────────────────────────────

ALTER TABLE public.automation_rules
  ADD COLUMN IF NOT EXISTS active_version_id UUID;

DO $$
BEGIN
  -- The active version must belong to this same rule and workspace.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.automation_rules'::regclass
       AND conname = 'fk_automation_rules_active_version'
  ) THEN
    ALTER TABLE public.automation_rules
      ADD CONSTRAINT fk_automation_rules_active_version
      FOREIGN KEY (workspace_id, id, active_version_id)
      REFERENCES public.automation_rule_versions (workspace_id, rule_id, id);
  END IF;

  -- Only comment rules are versioned, and one is never enabled without a
  -- published version (US-012 AC1: "activar una versión inmutable").
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.automation_rules'::regclass
       AND conname = 'ck_automation_rules_active_version'
  ) THEN
    ALTER TABLE public.automation_rules
      ADD CONSTRAINT ck_automation_rules_active_version
      CHECK (
        CASE WHEN trigger_type = 'comment_keyword'
             THEN NOT enabled OR active_version_id IS NOT NULL
             ELSE active_version_id IS NULL
        END
      );
  END IF;
END
$$;

-- ──────────────────────────────────────────────────────────
-- 6. automation_runs.rule_version_id
-- ──────────────────────────────────────────────────────────

-- NULL for v1 runs. A comment run records the exact version it executed, so
-- publishing a new version never changes what an earlier run did.
-- Deleting a rule already deletes its runs (existing
-- fk_automation_runs_rule_id_same_workspace, ON DELETE CASCADE) and, from this
-- file, its versions. SET NULL on rule_version_id only (Postgres 15+, like the
-- engine migration) keeps that double cascade from depending on its order and
-- never blocks a rule delete. Tested on a disposable copy, 2026-10-18.
ALTER TABLE public.automation_runs
  ADD COLUMN IF NOT EXISTS rule_version_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.automation_runs'::regclass
       AND conname = 'fk_automation_runs_rule_version_same_rule'
  ) THEN
    ALTER TABLE public.automation_runs
      ADD CONSTRAINT fk_automation_runs_rule_version_same_rule
      FOREIGN KEY (workspace_id, rule_id, rule_version_id)
      REFERENCES public.automation_rule_versions (workspace_id, rule_id, id)
      ON DELETE SET NULL (rule_version_id);
  END IF;
END
$$;
