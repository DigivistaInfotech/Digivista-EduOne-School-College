import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
let app: FastifyInstance,
  pool: pg.Pool,
  stop: () => Promise<void>,
  school: string,
  admin: string,
  parent: string,
  teacher: string,
  vehicle: string,
  route: string,
  stopId: string,
  head: string;
let masters: Array<{ id: string; kind: string; code: string }>;
const students: string[] = [];
const admission: string[] = [];
const day = (n: number) =>
  new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
async function login(email: string, password: string) {
  const r = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  expect(r.statusCode).toBe(200);
  return String(r.headers["set-cookie"]).split(";")[0]!;
}
async function call(
  method: "GET" | "POST" | "PATCH",
  path: string,
  payload?: unknown,
  cookie = admin,
) {
  const r = await app.inject({
    method,
    url: `/api/schools/${school}${path}`,
    headers: { cookie, origin: "http://localhost:5173" },
    payload: payload as never,
  });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}
beforeAll(async () => {
  const { startTestDatabase } = await import("@erp/db/test-database");
  const db = await startTestDatabase();
  stop = db.stop;
  process.env.DATABASE_URL = db.url;
  process.env.NODE_ENV = "test";
  const { buildApp } = await import("../src/app");
  const { getPool } = await import("../src/db");
  pool = getPool();
  app = await buildApp();
  await app.ready();
  school = (await pool.query("SELECT id FROM schools LIMIT 1")).rows[0].id;
  admin = await login("admin@demo.test", "Admin@12345");
  parent = await login("parent@demo.test", "Parent@12345");
  teacher = await login("teacher@demo.test", "Teacher@12345");
  masters = (await call("GET", "/transport/lookups")).body.masters;
  head = (
    await pool.query(
      `SELECT id FROM fee_heads WHERE school_id=$1 AND code='TRANSPORT'`,
      [school],
    )
  ).rows[0].id;
  for (let n = 1; n <= 4; n++) {
    const a = `TRANS-IMPORT-${n}`;
    students.push(
      (
        await pool.query(
          `INSERT INTO students(school_id,admission_number,first_name,status) VALUES($1,$2,$3,'active') RETURNING id`,
          [school, a, `ImportStudent${n}`],
        )
      ).rows[0].id,
    );
    admission.push(a);
  }
});
afterAll(async () => {
  await app?.close();
  const { closePool } = await import("../src/db");
  await closePool();
  await stop?.();
});
const master = (kind: string, code: string) =>
  masters.find((m) => m.kind === kind && m.code === code)!.id;
describe("Transport audit and masters", () => {
  it("validates registration, persists selected masters and denies nontransport BH student use", async () => {
    expect(
      (
        await call("POST", "/transport/vehicles", {
          registrationNumber: "INVALID",
          capacity: 10,
        })
      ).status,
    ).toBe(400);
    const made = await call("POST", "/transport/vehicles", {
      registrationNumber: "UP58AB1234",
      capacity: 3,
      status: "active",
      profile: {
        modelId: master("vehicle_model", "tata_starbus"),
        vehicleTypeId: master("vehicle_type", "school_bus"),
        fuelTypeId: master("fuel_type", "cng"),
        ownerName: "Demo transport operator",
        fitnessExpiresOn: day(40),
      },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    vehicle = made.body.id;
    expect(
      (
        await call("POST", "/transport/vehicles", {
          registrationNumber: "UP-58-AB-1234",
          capacity: 3,
        })
      ).status,
    ).toBe(409);
    const managerId = (
      await pool.query(
        `INSERT INTO users(email,display_name,password_hash,status) SELECT 'transport-audit@demo.test','Audit Transport Manager',password_hash,'active' FROM users WHERE email='admin@demo.test' RETURNING id`,
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO user_role_assignments(user_id,role_id,school_id,scope_type) SELECT $1,id,$2,'school' FROM roles WHERE code='transport'`,
      [managerId, school],
    );
    const manager = await login("transport-audit@demo.test", "Admin@12345");
    expect(
      (await call("GET", "/transport/lookups", undefined, manager)).status,
    ).toBe(200);
    expect((await call("GET", "/fee-heads", undefined, manager)).status).toBe(
      403,
    );

    const saved = (await call("GET", "/transport/vehicles")).body.items.find(
      (v: any) => v.id === vehicle,
    );
    expect(saved.registrationNumber).toBe("UP 58 AB 1234");
    expect(saved.model).toBe("Tata Starbus");
    expect(saved.profile.fuelTypeId).toBe(master("fuel_type", "cng"));
    expect(
      (
        await call("POST", "/transport/vehicles", {
          registrationNumber: "24BH2222AB",
          capacity: 20,
          profile: { vehicleTypeId: master("vehicle_type", "school_bus") },
        })
      ).status,
    ).toBe(400);
    expect(
      (await call("GET", "/transport/lookups", undefined, teacher)).status,
    ).toBe(403);
  });
  it("keeps master linkage tenant-bound and preserves deactivated existing mappings", async () => {
    const foreign = (
      await pool.query(
        `INSERT INTO schools(code,name) VALUES('TRANS-FOREIGN','Other school') RETURNING id`,
      )
    ).rows[0].id;
    await pool.query("SELECT seed_transport_masters($1)", [foreign]);
    const fid = (
      await pool.query(
        `SELECT id FROM institution_masters WHERE school_id=$1 AND kind='fuel_type' LIMIT 1`,
        [foreign],
      )
    ).rows[0].id;
    expect(
      (
        await call("PATCH", `/transport/vehicles/${vehicle}`, {
          profile: { fuelTypeId: fid },
        })
      ).status,
    ).toBe(400);
    const id = master("fuel_type", "cng");
    await pool.query(
      "UPDATE institution_masters SET active=false WHERE id=$1",
      [id],
    );
    expect(
      (
        await call("PATCH", `/transport/vehicles/${vehicle}`, {
          profile: { fuelTypeId: id, ownerName: "Updated operator" },
        })
      ).status,
    ).toBe(200);
    await pool.query("UPDATE institution_masters SET active=true WHERE id=$1", [
      id,
    ]);
  });
  it("records maintenance with planned/performed separation and authoritative GST breakdown", async () => {
    const job = master("maintenance_type", "periodic_service");
    const made = await call("POST", "/transport/maintenance", {
      vehicleId: vehicle,
      performedOn: day(-1),
      description: "Periodic maintenance",
      cost: 1,
      status: "completed",
      profile: {
        serviceTypeId: job,
        partsCost: 100,
        labourCost: 50,
        gstPercent: 18,
        odometerKm: 10000,
        nextServiceKm: 15000,
        invoiceNumber: "GARAGE-001",
        invoiceDate: day(-1),
      },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const saved = (await call("GET", "/transport/maintenance")).body.items.find(
      (r: any) => r.id === made.body.id,
    );
    expect(saved.cost).toBe(177);
    expect(saved.profile.jobCardNumber).toBeUndefined();
    expect(saved.profile.invoiceNumber).toBe("GARAGE-001");
    expect(
      (
        await call("POST", "/transport/maintenance", {
          vehicleId: vehicle,
          performedOn: day(-1),
          description: "Cost without audit reference",
          status: "completed",
          profile: { serviceTypeId: job, partsCost: 100 },
        })
      ).status,
    ).toBe(400);
    const scheduled = await call("POST", "/transport/maintenance", {
      vehicleId: vehicle,
      plannedOn: day(10),
      description: "Scheduled inspection",
      status: "scheduled",
      profile: { serviceTypeId: job },
    });
    expect(scheduled.status).toBe(201);
    const planned = (
      await call("GET", "/transport/maintenance")
    ).body.items.find((r: any) => r.id === scheduled.body.id);
    expect(planned.performedOn).toBeNull();
    expect(planned.plannedOn).toBe(day(10));
    expect(
      (
        await call("POST", "/transport/maintenance", {
          vehicleId: vehicle,
          description: "No completed date",
          status: "completed",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("POST", "/transport/maintenance", {
          vehicleId: vehicle,
          performedOn: day(3),
          description: "Future completed job",
          status: "completed",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("POST", "/transport/maintenance", {
          vehicleId: vehicle,
          performedOn: day(-1),
          description: "Wrong odometer",
          profile: { odometerKm: 10000, nextServiceKm: 9999 },
        })
      ).status,
    ).toBe(400);
  });
});
describe("Dated route tariffs and allocation imports", () => {
  it("publishes a dated transport tariff and rejects overlapping periods", async () => {
    const made = await call("POST", "/transport/routes", {
      code: "import_route",
      name: "Import Route",
      vehicleId: vehicle,
      feeHeadId: head,
      feeAmount: 1500,
      feePeriod: "monthly",
      feeEffectiveFrom: day(-10),
      feeEffectiveTo: day(30),
      status: "active",
      stops: [{ name: "Central stop", sequenceNo: 1 }],
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    route = made.body.id;
    stopId = (
      await pool.query("SELECT id FROM transport_stops WHERE route_id=$1", [
        route,
      ])
    ).rows[0].id;
    const tariffs = (await call("GET", "/transport/tariffs")).body.items;
    expect(
      tariffs.some(
        (t: any) =>
          t.routeId === route &&
          t.period === "monthly" &&
          Number(t.amount) === 1500,
      ),
    ).toBe(true);
    expect(
      (
        await call("POST", "/transport/tariffs", {
          routeId: route,
          feeHeadId: head,
          period: "annual",
          amount: 10000,
          effectiveFrom: day(1),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("POST", "/transport/tariffs", {
          routeId: route,
          feeHeadId: head,
          period: "monthly",
          amount: 1600,
          effectiveFrom: day(31),
          effectiveTo: day(90),
        })
      ).status,
    ).toBe(201);
  });
  it("previews and applies only validated student/route references; no payment flag is imported", async () => {
    const csv = `admission_number,route_code,stop_sequence,effective_from,valid_until,reminder_days,payment_reference\n${admission[0]},import_route,1,${day(0)},${day(45)},60,\n${admission[1]},import_route,1,${day(0)},${day(45)},30,`;
    const preview = await call("POST", "/transport/allocations/bulk", {
      csv,
      mode: "preview",
    });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.valid).toBe(true);
    expect(preview.body.createCount).toBe(2);
    expect(
      Number(
        (
          await pool.query(
            "SELECT count(*) FROM student_transport_allocations WHERE student_id=ANY($1::uuid[])",
            [students],
          )
        ).rows[0].count,
      ),
    ).toBe(0);
    const commit = await call("POST", "/transport/allocations/bulk", {
      csv,
      mode: "commit",
      confirmPreview: true,
    });
    expect(commit.status, JSON.stringify(commit.body)).toBe(200);
    expect(commit.body.created).toBe(2);
    const again = await call("POST", "/transport/allocations/bulk", {
      csv,
      mode: "preview",
    });
    expect(again.body.unchangedCount).toBe(2);
    const paid = await call("POST", "/transport/allocations/bulk", {
      csv: "admission_number,route_code,stop_sequence,paid\nX,import_route,1,true",
      mode: "preview",
    });
    expect(paid.status).toBe(400);
  });
  it("blocks shared-vehicle overflow and unverified payment references without partial writes", async () => {
    const other = await call("POST", "/transport/routes", {
      code: "same_vehicle",
      name: "Shared Vehicle Route",
      vehicleId: vehicle,
      stops: [{ name: "Other stop", sequenceNo: 1 }],
    });
    expect(other.status).toBe(201);
    const otherStop = (
      await pool.query("SELECT id FROM transport_stops WHERE route_id=$1", [
        other.body.id,
      ])
    ).rows[0].id;
    expect(
      (
        await call("POST", "/transport/allocations", {
          studentId: students[2],
          routeId: other.body.id,
          stopId: otherStop,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call("POST", "/transport/allocations", {
          studentId: students[3],
          routeId: route,
          stopId,
        })
      ).status,
    ).toBe(409);
    const ref = await call("POST", "/transport/allocations/bulk", {
      csv: `admission_number,route_code,stop_sequence,payment_reference\n${admission[3]},import_route,1,NOT-A-PAYMENT`,
      mode: "preview",
    });
    expect(ref.body.valid).toBe(false);
    expect(ref.body.rows[0].errors.join(" ")).toContain("Payment reference");
  });
});
describe("Family renewal visibility and guarded review", () => {
  it("shows actual linked allocation and renewal due data and keeps other families isolated", async () => {
    const child = (
      await pool.query(
        `SELECT s.id FROM students s JOIN student_guardians sg ON sg.school_id=s.school_id AND sg.student_id=s.id JOIN guardians g ON g.school_id=sg.school_id AND g.id=sg.guardian_id JOIN users u ON u.id=g.user_id WHERE s.school_id=$1 AND u.email='parent@demo.test' AND sg.portal_access_status='verified' LIMIT 1`,
        [school],
      )
    ).rows[0].id;
    let a = (
      await pool.query(
        `SELECT id FROM student_transport_allocations WHERE school_id=$1 AND student_id=$2 AND status='active'`,
        [school, child],
      )
    ).rows[0];
    if (!a) {
      a = (
        await pool.query(
          `INSERT INTO student_transport_allocations(school_id,student_id,route_id,stop_id,effective_from,created_by) VALUES($1,$2,$3,$4,$5,(SELECT id FROM users WHERE email='admin@demo.test')) RETURNING id`,
          [school, child, route, stopId, day(-30)],
        )
      ).rows[0];
    }
    await pool.query(
      "UPDATE student_transport_allocations SET valid_until=$3,reminder_days=60 WHERE school_id=$1 AND id=$2",
      [school, a.id, day(30)],
    );
    const path = `/portal/children/${child}/transport`;
    const actual = await call("GET", path + "/subscription", undefined, parent);
    expect(actual.status, JSON.stringify(actual.body)).toBe(200);
    expect(actual.body.assigned).toBe(true);
    expect(actual.body.renewalDue).toBe(true);
    expect(actual.body.allocation.validUntil).toBe(day(30));
    expect(
      (
        await call(
          "GET",
          `/portal/children/${students[0]}/transport/subscription`,
          undefined,
          parent,
        )
      ).status,
    ).toBe(404);
    const request = await call(
      "POST",
      path + "/renewals",
      { requestedUntil: day(150), reason: "Continue the same route" },
      parent,
    );
    expect(request.status, JSON.stringify(request.body)).toBe(201);
    expect(
      (
        await call(
          "POST",
          path + "/renewals",
          { requestedUntil: day(160) },
          parent,
        )
      ).status,
    ).toBe(409);
    const due = await call("GET", "/transport/renewal-due");
    expect(due.body.allocations.some((x: any) => x.id === a.id)).toBe(true);
    expect(
      (
        await call("POST", `/transport/renewals/${request.body.id}/review`, {
          decision: "approve",
          note: "Approved next transport period",
        })
      ).status,
    ).toBe(200);
    const renewed = await call(
      "GET",
      path + "/subscription",
      undefined,
      parent,
    );
    expect(renewed.body.allocation.validUntil).toBe(day(150));
    expect(renewed.body.renewals[0].status).toBe("approved");
    expect(renewed.body.fees.status).not.toBe("paid");
  });
});
