import type pg from "pg";
type Queryable = Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query">;
export async function getTransportSubscription(
  db: Queryable,
  school: string,
  student: string,
  today: string,
) {
  const allocation =
    (
      await db.query<{
        id: string;
        routeId: string;
        routeName: string;
        routeCode: string;
        stopName: string;
        vehicleRegistration: string | null;
        driverName: string | null;
        driverPhone: string | null;
        pickup: string | null;
        drop: string | null;
        effectiveFrom: string;
        validUntil: string | null;
        reminderDays: number;
        feeHeadId: string | null;
      }>(
        `SELECT a.id,a.route_id AS "routeId",r.name AS "routeName",r.code AS "routeCode",s.name AS "stopName",v.registration_number AS "vehicleRegistration",d.full_name AS "driverName",d.phone AS "driverPhone",s.scheduled_pickup::text AS pickup,s.scheduled_drop::text AS drop,a.effective_from::text AS "effectiveFrom",a.valid_until::text AS "validUntil",a.reminder_days AS "reminderDays",r.fee_head_id AS "feeHeadId" FROM student_transport_allocations a JOIN transport_routes r ON r.school_id=a.school_id AND r.id=a.route_id JOIN transport_stops s ON s.school_id=a.school_id AND s.id=a.stop_id LEFT JOIN transport_vehicles v ON v.school_id=r.school_id AND v.id=r.vehicle_id LEFT JOIN transport_drivers d ON d.school_id=r.school_id AND d.id=r.driver_id WHERE a.school_id=$1 AND a.student_id=$2 AND a.status='active' ORDER BY a.effective_from DESC LIMIT 1`,
        [school, student],
      )
    ).rows[0] ?? null;
  if (!allocation)
    return {
      assigned: false,
      allocation: null,
      tariff: null,
      fees: null,
      renewals: [],
    };
  const tariff =
    (
      await db.query(
        `SELECT t.id,t.period,t.amount,t.effective_from::text AS "effectiveFrom",t.effective_to::text AS "effectiveTo",f.name AS "feeHeadName" FROM transport_tariffs t JOIN fee_heads f ON f.school_id=t.school_id AND f.id=t.fee_head_id WHERE t.school_id=$1 AND t.route_id=$2 AND t.active AND t.effective_from<=$3::date AND (t.effective_to IS NULL OR t.effective_to>=$3::date) ORDER BY t.effective_from DESC LIMIT 1`,
        [school, allocation.routeId, today],
      )
    ).rows[0] ?? null;
  const charges = (
    await db.query<{ net: string; paid: string; refunds: string }>(
      `SELECT (c.amount-c.concession_amount-c.write_off_amount)::text AS net,coalesce((SELECT sum(pa.amount) FROM payment_allocations pa JOIN payments p ON p.school_id=pa.school_id AND p.id=pa.payment_id AND p.status='recorded' WHERE pa.school_id=c.school_id AND pa.charge_id=c.id),0)::text AS paid,coalesce((SELECT sum(r.amount) FROM refunds r WHERE r.school_id=c.school_id AND r.status='approved' AND r.payment_id IN(SELECT pa.payment_id FROM payment_allocations pa WHERE pa.school_id=c.school_id AND pa.charge_id=c.id)),0)::text AS refunds FROM student_charges c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id AND y.status='active' JOIN fee_heads f ON f.school_id=c.school_id AND f.id=c.fee_head_id WHERE c.school_id=$1 AND c.student_id=$2 AND (c.fee_head_id=$3::uuid OR f.code ILIKE '%transport%' OR f.name ILIKE '%transport%')`,
      [school, student, allocation.feeHeadId],
    )
  ).rows;
  const charged = charges.reduce((sum, c) => sum + Number(c.net), 0);
  const allocatedPayments = charges.reduce((sum, c) => sum + Number(c.paid), 0);
  const refundReview = charges.some((c) => Number(c.refunds) > 0);
  const outstanding = refundReview
    ? null
    : Math.max(0, Math.round((charged - allocatedPayments) * 100) / 100);
  const renewals = (
    await db.query(
      `SELECT id,requested_until::text AS "requestedUntil",status,reason,review_note AS "reviewNote" FROM transport_renewal_requests WHERE school_id=$1 AND allocation_id=$2 ORDER BY created_at DESC LIMIT 10`,
      [school, allocation.id],
    )
  ).rows;
  const daysRemaining = allocation.validUntil
    ? Math.ceil(
        (Date.parse(allocation.validUntil + "T00:00:00Z") -
          Date.parse(today + "T00:00:00Z")) /
          86400000,
      )
    : null;
  return {
    assigned: true,
    allocation,
    tariff,
    fees: {
      charged,
      allocatedPayments,
      outstanding,
      status: refundReview
        ? "finance_review_required"
        : charges.length === 0
          ? "not_billed"
          : outstanding === 0
            ? "settled"
            : allocatedPayments > 0
              ? "partly_paid"
              : "unpaid",
      note: refundReview
        ? "Associated payments contain refunds; finance must confirm the transport split."
        : "Derived from posted central fee charges and recorded payment allocations, not an uploaded paid flag.",
    },
    renewals,
    daysRemaining,
    renewalDue:
      daysRemaining !== null && daysRemaining <= allocation.reminderDays,
  };
}
