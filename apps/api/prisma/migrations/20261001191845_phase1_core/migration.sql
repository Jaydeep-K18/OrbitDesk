-- CreateEnum
CREATE TYPE "TaskCategory" AS ENUM ('coding_practice', 'study', 'project_dev', 'writing', 'research', 'other');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('todo', 'in_progress', 'done');

-- CreateEnum
CREATE TYPE "DomainListType" AS ENUM ('blocked', 'relevant', 'never_track', 'always_distraction');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'ENDED_EARLY', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BlockKind" AS ENUM ('work', 'break');

-- CreateEnum
CREATE TYPE "SessionDomainKind" AS ENUM ('blocked', 'relevant');

-- CreateEnum
CREATE TYPE "ActivityLabel" AS ENUM ('PLANNED', 'UNPLANNED_RELEVANT', 'DISTRACTION', 'BLOCKED', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "LabelSource" AS ENUM ('session_list', 'user_override', 'rule', 'llm', 'ml', 'user_feedback');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('extension', 'collector');

-- CreateEnum
CREATE TYPE "EmailTokenPurpose" AS ENUM ('verify', 'reset');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "email_verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "user_id" UUID NOT NULL,
    "tracking_enabled" BOOLEAN NOT NULL DEFAULT true,
    "title_collection_enabled" BOOLEAN NOT NULL DEFAULT false,
    "widget_enabled" BOOLEAN NOT NULL DEFAULT true,
    "block_during_breaks" BOOLEAN NOT NULL DEFAULT false,
    "activity_retention_days" INTEGER NOT NULL DEFAULT 180,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "email_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "EmailTokenPurpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by_id" UUID,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "DeviceType" NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "scopes" TEXT[],
    "last_seen_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pairing_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pairing_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "event" TEXT NOT NULL,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "category" "TaskCategory" NOT NULL DEFAULT 'other',
    "status" "TaskStatus" NOT NULL DEFAULT 'todo',
    "estimate_min" INTEGER,
    "due_date" DATE,
    "tags" TEXT[],
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_rules" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "host" TEXT NOT NULL,
    "list" "DomainListType" NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '*',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_categories" (
    "host" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'seed',

    CONSTRAINT "domain_categories_pkey" PRIMARY KEY ("host")
);

-- CreateTable
CREATE TABLE "focus_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "SessionStatus" NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "end_reason" TEXT,
    "plan_id" UUID,
    "block_during_breaks" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "finalized_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "focus_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "focus_session_blocks" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "idx" INTEGER NOT NULL,
    "kind" "BlockKind" NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "title" TEXT,

    CONSTRAINT "focus_session_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_tasks" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "task_id" UUID,
    "task_title" TEXT NOT NULL,
    "task_category" "TaskCategory" NOT NULL,
    "block_id" UUID,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "session_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_domains" (
    "session_id" UUID NOT NULL,
    "host" TEXT NOT NULL,
    "kind" "SessionDomainKind" NOT NULL,
    "added_mid_session" BOOLEAN NOT NULL DEFAULT false,
    "removed_at" TIMESTAMPTZ(3),

    CONSTRAINT "session_domains_pkey" PRIMARY KEY ("session_id","host","kind")
);

-- CreateTable
CREATE TABLE "session_presence" (
    "session_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "offline_sec" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "session_presence_pkey" PRIMARY KEY ("session_id","device_id")
);

-- CreateTable
CREATE TABLE "activity_segments" (
    "id" UUID NOT NULL,
    "client_event_id" UUID NOT NULL,
    "part" INTEGER NOT NULL DEFAULT 0,
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "device_id" UUID,
    "block_id" UUID,
    "host" TEXT NOT NULL,
    "registrable_domain" TEXT NOT NULL,
    "title" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_sec" INTEGER NOT NULL,
    "label" "ActivityLabel",
    "confidence" DOUBLE PRECISION,
    "label_source" "LabelSource",
    "reason_code" TEXT,
    "explanation" TEXT,
    "classifier_version" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_attempts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "device_id" UUID,
    "host" TEXT NOT NULL,
    "attempted_at" TIMESTAMPTZ(3) NOT NULL,
    "deduped" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "blocked_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segment_feedback" (
    "id" UUID NOT NULL,
    "segment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "old_label" "ActivityLabel",
    "new_label" "ActivityLabel" NOT NULL,
    "apply_to_future" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "segment_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_reports" (
    "session_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "metrics" JSONB NOT NULL,
    "domains" JSONB NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "session_reports_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "user_daily_stats" (
    "user_id" UUID NOT NULL,
    "local_date" DATE NOT NULL,
    "focus_sec" INTEGER NOT NULL DEFAULT 0,
    "sessions_started" INTEGER NOT NULL DEFAULT 0,
    "sessions_completed" INTEGER NOT NULL DEFAULT 0,
    "planned_sec" INTEGER NOT NULL DEFAULT 0,
    "relevant_sec" INTEGER NOT NULL DEFAULT 0,
    "distraction_sec" INTEGER NOT NULL DEFAULT 0,
    "uncertain_sec" INTEGER NOT NULL DEFAULT 0,
    "outside_browser_sec" INTEGER NOT NULL DEFAULT 0,
    "blocked_attempts" INTEGER NOT NULL DEFAULT 0,
    "switches" INTEGER NOT NULL DEFAULT 0,
    "tasks_completed" INTEGER NOT NULL DEFAULT 0,
    "tasks_planned" INTEGER NOT NULL DEFAULT 0,
    "hourly_focus_sec" INTEGER[],
    "hourly_productive_sec" INTEGER[],
    "hourly_distraction_sec" INTEGER[],
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_daily_stats_pkey" PRIMARY KEY ("user_id","local_date")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "email_tokens_token_hash_key" ON "email_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_tokens_user_id_purpose_idx" ON "email_tokens"("user_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "devices_user_id_idx" ON "devices"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "pairing_codes_code_hash_key" ON "pairing_codes"("code_hash");

-- CreateIndex
CREATE INDEX "audit_log_user_id_created_at_idx" ON "audit_log"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "tasks_user_id_status_idx" ON "tasks"("user_id", "status");

-- CreateIndex
CREATE INDEX "tasks_user_id_created_at_idx" ON "tasks"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "domain_rules_user_id_host_list_scope_key" ON "domain_rules"("user_id", "host", "list", "scope");

-- CreateIndex
CREATE INDEX "focus_sessions_user_id_starts_at_idx" ON "focus_sessions"("user_id", "starts_at" DESC);

-- CreateIndex
CREATE INDEX "focus_sessions_status_ends_at_idx" ON "focus_sessions"("status", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "focus_session_blocks_session_id_idx_key" ON "focus_session_blocks"("session_id", "idx");

-- CreateIndex
CREATE UNIQUE INDEX "session_tasks_session_id_task_id_key" ON "session_tasks"("session_id", "task_id");

-- CreateIndex
CREATE INDEX "activity_segments_session_id_started_at_idx" ON "activity_segments"("session_id", "started_at");

-- CreateIndex
CREATE INDEX "activity_segments_user_id_started_at_idx" ON "activity_segments"("user_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "activity_segments_client_event_id_part_key" ON "activity_segments"("client_event_id", "part");

-- CreateIndex
CREATE INDEX "blocked_attempts_session_id_attempted_at_idx" ON "blocked_attempts"("session_id", "attempted_at");

-- CreateIndex
CREATE INDEX "blocked_attempts_user_id_attempted_at_idx" ON "blocked_attempts"("user_id", "attempted_at");

-- CreateIndex
CREATE INDEX "segment_feedback_segment_id_idx" ON "segment_feedback"("segment_id");

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_rules" ADD CONSTRAINT "domain_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_session_blocks" ADD CONSTRAINT "focus_session_blocks_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "focus_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_tasks" ADD CONSTRAINT "session_tasks_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "focus_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_tasks" ADD CONSTRAINT "session_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_tasks" ADD CONSTRAINT "session_tasks_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "focus_session_blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_domains" ADD CONSTRAINT "session_domains_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "focus_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_presence" ADD CONSTRAINT "session_presence_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "focus_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_presence" ADD CONSTRAINT "session_presence_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_segments" ADD CONSTRAINT "activity_segments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_segments" ADD CONSTRAINT "activity_segments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "focus_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_segments" ADD CONSTRAINT "activity_segments_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "focus_session_blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_attempts" ADD CONSTRAINT "blocked_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_attempts" ADD CONSTRAINT "blocked_attempts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "focus_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_feedback" ADD CONSTRAINT "segment_feedback_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "activity_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_feedback" ADD CONSTRAINT "segment_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_reports" ADD CONSTRAINT "session_reports_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "focus_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_daily_stats" ADD CONSTRAINT "user_daily_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints Prisma cannot express (ROADMAP §7.2 invariants)
-- ---------------------------------------------------------------------------

-- At most one non-terminal session per user at any instant.
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_no_overlap"
  EXCLUDE USING gist ("user_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&)
  WHERE ("status" IN ('SCHEDULED', 'ACTIVE'));

ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_time_order" CHECK ("ends_at" > "starts_at");
ALTER TABLE "focus_session_blocks" ADD CONSTRAINT "focus_session_blocks_time_order" CHECK ("ends_at" > "starts_at");
ALTER TABLE "activity_segments" ADD CONSTRAINT "activity_segments_time_order" CHECK ("ended_at" >= "started_at");
ALTER TABLE "activity_segments" ADD CONSTRAINT "activity_segments_confidence_range" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_retention_range" CHECK ("activity_retention_days" BETWEEN 7 AND 365);
