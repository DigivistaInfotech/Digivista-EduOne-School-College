-- Add structured metadata needed by the notice specifications.
ALTER TABLE notices
  ADD COLUMN category VARCHAR(40) NOT NULL DEFAULT 'general',
  ADD COLUMN priority VARCHAR(12) NOT NULL DEFAULT 'normal',
  ADD CONSTRAINT chk_notices_category CHECK (category IN (
    'general', 'academic', 'examination', 'holiday', 'fee', 'attendance',
    'parent_meeting', 'school_event', 'competition', 'admission', 'transport',
    'library', 'health_safety', 'achievement', 'staff', 'emergency'
  )),
  ADD CONSTRAINT chk_notices_priority CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

CREATE INDEX ix_notices_school_category_priority
  ON notices (school_id, category, priority, created_at DESC);
