-- `dormant` is a fourth capacity status, and the CHECK constraint from 0014
-- does not know it.
--
-- Found by running the dispatcher against a stub endpoint that always answers
-- 429: the failover worked, the user got their answer from the next source in
-- the pool, and the write recording the dormancy failed silently into a warning
-- log. Best-effort writes hide their own bugs, which is exactly why this path
-- was exercised against a live database instead of only a unit test.
--
-- Its own migration rather than an edit to 0017, which had already been
-- applied: a migration that has run is history, and editing it in place means
-- one database gets the fix and another silently does not.

ALTER TABLE "capacity_source" DROP CONSTRAINT IF EXISTS "capacity_source_status_check";
ALTER TABLE "capacity_source" ADD CONSTRAINT "capacity_source_status_check"
  CHECK ("status" IN ('active', 'exhausted', 'dormant', 'disabled'));
