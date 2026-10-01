-- Phase 0: enable extensions required by later migrations.
--   btree_gist: exclusion constraint preventing overlapping focus sessions (Phase 1)
--   citext:     case-insensitive unique emails (Phase 1)
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "citext";
