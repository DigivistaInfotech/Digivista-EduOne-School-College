-- Optional lesson notes for timetable cards. Existing timetable rows remain valid.
ALTER TABLE timetable_slots
  ADD COLUMN IF NOT EXISTS notes VARCHAR(500);
