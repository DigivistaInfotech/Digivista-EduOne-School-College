-- Retire route stops instead of deleting them when historical transport
-- allocations still reference the stop. The allocation history is evidence of
-- which stop a student was assigned to, so the row must survive.
ALTER TABLE transport_stops ADD COLUMN retired_at TIMESTAMPTZ;

ALTER TABLE transport_stops DROP CONSTRAINT uq_transport_stops_route_sequence;

CREATE UNIQUE INDEX uq_transport_stops_active_sequence
  ON transport_stops (school_id, route_id, sequence_no)
  WHERE retired_at IS NULL;

CREATE INDEX idx_transport_stops_active
  ON transport_stops (school_id, route_id, sequence_no)
  WHERE retired_at IS NULL;
