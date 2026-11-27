-- Expand the existing two-step import workflow to reusable school masters.
-- Existing batches are retained and remain valid.
ALTER TABLE import_batches
  DROP CONSTRAINT IF EXISTS import_batches_entity_type_check;

ALTER TABLE import_batches
  ADD CONSTRAINT import_batches_entity_type_check
  CHECK (entity_type IN (
    'students', 'library_books', 'vendors', 'academic_years', 'classes',
    'sections', 'subjects', 'subject_offerings', 'staff', 'rooms', 'timetable_periods', 'fee_heads', 'institution_masters'
  ));
