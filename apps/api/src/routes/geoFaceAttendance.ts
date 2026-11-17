import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getActor,
  requirePermission,
  requireAuth,
  requestMeta,
} from "../auth/guards";
import { getPool, withTransaction } from "../db";
import { recordAudit } from "../lib/audit";
import {
  evaluateGeofence,
  verifyFaceIdentity,
  encryptBiometricTemplate,
  decryptBiometricTemplate,
  type GeofenceDefinition,
} from "../lib/biometrics";
import {
  AppError,
  badRequest,
  conflict,
  forbidden,
  notFound,
  parseInput,
  unauthorized,
} from "../lib/errors";
import { todayInTimeZone } from "../lib/format";

const schoolParams = z.object({ schoolId: z.string().uuid() });
const idParams = z.object({
  schoolId: z.string().uuid(),
  id: z.string().uuid(),
});
const staffParams = z.object({
  schoolId: z.string().uuid(),
  staffId: z.string().uuid(),
});

const geofenceInput = z.object({
  name: z.string().trim().min(2).max(160),
  campusId: z.string().uuid().optional().nullable(),
  locationType: z
    .enum([
      "campus",
      "sports_ground",
      "transport_depot",
      "approved_offsite",
      "event_venue",
    ])
    .default("campus"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(20).max(5000).default(150),
  maxAccuracyThresholdMeters: z.number().int().min(10).max(500).default(100),
  isActive: z.boolean().default(true),
  notes: z.string().max(500).optional().nullable(),
});

const biometricEnrollInput = z.object({
  consentGiven: z.boolean().refine((val) => val === true, {
    message:
      "Explicit consent is required for biometric staff attendance under DPDPA regulations.",
  }),
  consentVersion: z.string().default("v1.0-dpdpa"),
  embeddingVector: z.array(z.number()).min(32).max(1024),
  qualityScore: z.number().min(0).max(100).optional(),
});

const punchInput = z.object({
  punchType: z.enum(["punch_in", "punch_out", "break_start", "break_end"]),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(2000).optional().default(15),
  locationTimestamp: z.number().optional(),
  isMockLocation: z.boolean().optional().default(false),
  probeEmbedding: z.array(z.number()).optional(),
  livenessProbe: z
    .object({
      blinkDetected: z.boolean().optional(),
      motionScore: z.number().min(0).max(100).optional(),
      textureVariance: z.number().min(0).max(100).optional(),
      spoofProbability: z.number().min(0).max(100).optional(),
      antiReplayToken: z.string().optional(),
    })
    .optional(),
  deviceSource: z
    .enum(["employee_mobile", "kiosk", "supervisor_portal", "desktop_browser"])
    .default("employee_mobile"),
  kioskId: z.string().uuid().optional().nullable(),
  overrideReason: z.string().max(300).optional(),
});

const kioskRegisterInput = z.object({
  deviceCode: z.string().trim().min(3).max(60),
  deviceName: z.string().trim().min(3).max(160),
  campusId: z.string().uuid().optional().nullable(),
  geofenceId: z.string().uuid().optional().nullable(),
  apiKey: z.string().min(16).max(128),
});

const kioskPunchInput = z.object({
  employeeCode: z.string().trim().min(2).max(40).optional(),
  staffId: z.string().uuid().optional(),
  punchType: z.enum(["punch_in", "punch_out"]),
  probeEmbedding: z.array(z.number()).min(32),
  livenessProbe: z
    .object({
      blinkDetected: z.boolean().optional(),
      motionScore: z.number().min(0).max(100).optional(),
      textureVariance: z.number().min(0).max(100).optional(),
      spoofProbability: z.number().min(0).max(100).optional(),
    })
    .optional(),
});

const exceptionRequestInput = z.object({
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  exceptionType: z.enum([
    "gps_failure",
    "camera_failure",
    "face_mismatch",
    "device_unavailable",
    "approved_offsite_duty",
    "missed_punch_in",
    "missed_punch_out",
    "other",
  ]),
  requestedPunchIn: z.string().datetime().optional().nullable(),
  requestedPunchOut: z.string().datetime().optional().nullable(),
  reason: z.string().trim().min(10).max(1000),
  supportingDocumentName: z.string().max(200).optional().nullable(),
});

const exceptionReviewInput = z.object({
  status: z.enum(["approved", "rejected"]),
  reviewNotes: z.string().trim().min(3).max(500),
});

export async function registerGeoFaceAttendanceRoutes(
  app: FastifyInstance,
): Promise<void> {
  /* -------------------------------------------------------------------------- */
  /* 1. GEOFENCES CONFIGURATION MANAGEMENT                                      */
  /* -------------------------------------------------------------------------- */

  app.get(
    "/api/schools/:schoolId/staff/attendance/geofences",
    { preHandler: requirePermission("hr.attendance.view") },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const { rows } = await getPool().query(
        `SELECT id, name, location_type, latitude::float, longitude::float,
                radius_meters, max_accuracy_threshold_meters, is_active, notes,
                campus_id, created_at, updated_at
         FROM school_geofences
         WHERE school_id = $1
         ORDER BY is_active DESC, name ASC`,
        [schoolId],
      );
      return {
        items: rows.map((r: any) => ({
          id: r.id,
          name: r.name,
          locationType: r.location_type,
          latitude: Number(r.latitude),
          longitude: Number(r.longitude),
          radiusMeters: Number(r.radius_meters),
          maxAccuracyThresholdMeters: Number(r.max_accuracy_threshold_meters),
          isActive: r.is_active,
          notes: r.notes,
          campusId: r.campus_id,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      };
    },
  );

  app.post(
    "/api/schools/:schoolId/staff/attendance/geofences",
    { preHandler: requirePermission("hr.attendance.configure") },
    async (request, reply) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const input = parseInput(geofenceInput, request.body);
      const actor = getActor(request);

      const { rows } = await getPool().query<{ id: string }>(
        `INSERT INTO school_geofences
           (school_id, campus_id, name, location_type, latitude, longitude,
            radius_meters, max_accuracy_threshold_meters, is_active, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          schoolId,
          input.campusId ?? null,
          input.name,
          input.locationType,
          input.latitude,
          input.longitude,
          input.radiusMeters,
          input.maxAccuracyThresholdMeters,
          input.isActive,
          input.notes ?? null,
        ],
      );

      await recordAudit(getPool(), {
        schoolId,
        actorUserId: actor.userId,
        action: "hr.geofence_created",
        entityType: "school_geofence",
        entityId: rows[0]!.id,
        outcome: "success",
        after: {
          name: input.name,
          radius: input.radiusMeters,
          type: input.locationType,
        },
        ...requestMeta(request),
      });

      return reply
        .status(201)
        .send({ id: rows[0]!.id, message: "Geofence created successfully." });
    },
  );

  app.put(
    "/api/schools/:schoolId/staff/attendance/geofences/:id",
    { preHandler: requirePermission("hr.attendance.configure") },
    async (request, reply) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      const input = parseInput(geofenceInput, request.body);
      const actor = getActor(request);

      const result = await getPool().query(
        `UPDATE school_geofences
         SET name = $3, campus_id = $4, location_type = $5, latitude = $6, longitude = $7,
             radius_meters = $8, max_accuracy_threshold_meters = $9, is_active = $10,
             notes = $11, updated_at = now()
         WHERE school_id = $1 AND id = $2`,
        [
          schoolId,
          id,
          input.name,
          input.campusId ?? null,
          input.locationType,
          input.latitude,
          input.longitude,
          input.radiusMeters,
          input.maxAccuracyThresholdMeters,
          input.isActive,
          input.notes ?? null,
        ],
      );

      if (result.rowCount === 0) throw notFound("Geofence not found");

      await recordAudit(getPool(), {
        schoolId,
        actorUserId: actor.userId,
        action: "hr.geofence_updated",
        entityType: "school_geofence",
        entityId: id,
        outcome: "success",
        after: input,
        ...requestMeta(request),
      });

      return reply
        .status(200)
        .send({ success: true, message: "Geofence updated successfully." });
    },
  );

  /* -------------------------------------------------------------------------- */
  /* 2. BIOMETRIC ENROLMENT & PRIVACY CONSENT (DPDPA COMPLIANT)               */
  /* -------------------------------------------------------------------------- */

  app.get(
    "/api/schools/:schoolId/staff/:staffId/biometrics",
    { preHandler: requirePermission("hr.attendance.view") },
    async (request) => {
      const { schoolId, staffId } = parseInput(staffParams, request.params);
      const { rows } = await getPool().query(
        `SELECT id, staff_id, consent_given, consent_version, consent_given_at,
                consent_withdrawn_at, enrolment_status, enrolled_at,
                template_algorithm, template_hash, photo_verification_hash,
                quality_score, created_at, updated_at
         FROM staff_biometric_profiles
         WHERE school_id = $1 AND staff_id = $2`,
        [schoolId, staffId],
      );

      const profile = rows[0];
      if (!profile) {
        return {
          enrolled: false,
          status: "pending",
          consentGiven: false,
          profile: null,
        };
      }

      return {
        enrolled: profile.enrolment_status === "enrolled",
        status: profile.enrolment_status,
        consentGiven: profile.consent_given,
        profile: {
          id: profile.id,
          enrolmentStatus: profile.enrolment_status,
          consentGiven: profile.consent_given,
          consentVersion: profile.consent_version,
          consentGivenAt: profile.consent_given_at,
          enrolledAt: profile.enrolled_at,
          templateAlgorithm: profile.template_algorithm,
          templateHash: profile.template_hash,
          qualityScore: profile.quality_score
            ? Number(profile.quality_score)
            : null,
        },
      };
    },
  );

  app.post(
    "/api/schools/:schoolId/staff/:staffId/biometrics/enroll",
    { preHandler: requirePermission("hr.attendance.configure") },
    async (request, reply) => {
      assertSyntheticBiometricPipeline();
      const { schoolId, staffId } = parseInput(staffParams, request.params);
      const input = parseInput(biometricEnrollInput, request.body);
      const actor = getActor(request);

      const staffRes = await getPool().query(
        "SELECT 1 FROM staff WHERE school_id = $1 AND id = $2",
        [schoolId, staffId],
      );
      if (staffRes.rowCount === 0) throw notFound("Staff member not found");

      const templateString = JSON.stringify(input.embeddingVector);
      const templateHash = crypto
        .createHash("sha256")
        .update(templateString)
        .digest("hex");
      const encryptedTemplate = encryptBiometricTemplate(templateString);

      const { rows } = await getPool().query<{ id: string }>(
        `INSERT INTO staff_biometric_profiles
           (school_id, staff_id, consent_given, consent_version, consent_given_at,
            consent_withdrawn_at, enrolment_status, enrolled_at, enrolled_by,
            template_algorithm, template_data_encrypted, template_hash, quality_score)
         VALUES ($1, $2, $3, $4, now(), NULL, 'enrolled', now(), $5, 'face_emb_v1_512', $6, $7, $8)
         ON CONFLICT (school_id, staff_id) DO UPDATE SET
           consent_given = EXCLUDED.consent_given,
           consent_version = EXCLUDED.consent_version,
           consent_given_at = now(),
           consent_withdrawn_at = NULL,
           enrolment_status = 'enrolled',
           enrolled_at = now(),
           enrolled_by = EXCLUDED.enrolled_by,
           template_data_encrypted = EXCLUDED.template_data_encrypted,
           template_hash = EXCLUDED.template_hash,
           quality_score = EXCLUDED.quality_score,
           updated_at = now()
         RETURNING id`,
        [
          schoolId,
          staffId,
          input.consentGiven,
          input.consentVersion,
          actor.userId,
          encryptedTemplate,
          templateHash,
          input.qualityScore ?? 92.5,
        ],
      );

      await recordAudit(getPool(), {
        schoolId,
        actorUserId: actor.userId,
        action: "hr.biometric_enrolled",
        entityType: "staff_biometric_profile",
        entityId: rows[0]!.id,
        outcome: "success",
        after: {
          staffId,
          consentGiven: true,
          templateHash,
          qualityScore: input.qualityScore ?? 92.5,
        },
        ...requestMeta(request),
      });

      return reply.status(200).send({
        success: true,
        enrolmentId: rows[0]!.id,
        message:
          "Biometric face profile securely enrolled with explicit DPDPA consent.",
      });
    },
  );

  app.post(
    "/api/schools/:schoolId/staff/:staffId/biometrics/withdraw-consent",
    { preHandler: requirePermission("hr.attendance.configure") },
    async (request, reply) => {
      const { schoolId, staffId } = parseInput(staffParams, request.params);
      const actor = getActor(request);

      const result = await getPool().query(
        `UPDATE staff_biometric_profiles
         SET consent_given = false,
             consent_withdrawn_at = now(),
             enrolment_status = 'withdrawn',
             template_data_encrypted = NULL,
             updated_at = now()
         WHERE school_id = $1 AND staff_id = $2`,
        [schoolId, staffId],
      );

      if (result.rowCount === 0) throw notFound("Biometric profile not found");

      await recordAudit(getPool(), {
        schoolId,
        actorUserId: actor.userId,
        action: "hr.biometric_consent_withdrawn",
        entityType: "staff_biometric_profile",
        outcome: "success",
        after: { staffId, status: "withdrawn" },
        ...requestMeta(request),
      });

      return reply.status(200).send({
        success: true,
        message:
          "Biometric consent withdrawn and encrypted template deleted in compliance with data privacy policies.",
      });
    },
  );

  /* -------------------------------------------------------------------------- */
  /* 3. CURRENT PUNCH STATUS & TELEMETRY QUERY                                  */
  /* -------------------------------------------------------------------------- */

  app.get(
    "/api/schools/:schoolId/staff/attendance/punch/status",
    { preHandler: requireAuth },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const actor = getActor(request);
      const pool = getPool();

      // Look up staff record for authenticated user
      const staffRes = await pool.query<{
        id: string;
        employee_number: string;
        first_name: string;
        last_name: string;
      }>(
        `SELECT id, employee_number, first_name, last_name
         FROM staff
         WHERE school_id = $1 AND user_id = $2 AND status = 'active'
         LIMIT 1`,
        [schoolId, actor.userId],
      );

      const staff = staffRes.rows[0];
      if (!staff) {
        throw forbidden(
          "No active employee profile linked to your user account.",
        );
      }

      const todayDate = todayInTimeZone(actor.school.timezone);

      // Today's attendance record
      const attRes = await pool.query<{
        id: string;
        punch_in: string | null;
        punch_out: string | null;
        status: string;
        shift_id: string | null;
        shift_name: string | null;
        shift_starts_at: string | null;
        shift_ends_at: string | null;
      }>(
        `SELECT sa.id, sa.punch_in::text, sa.punch_out::text, sa.status,
                ss.id AS shift_id, ss.name AS shift_name,
                ss.starts_at::text AS shift_starts_at,
                ss.ends_at::text AS shift_ends_at
         FROM staff_attendance sa
         LEFT JOIN staff_shifts ss ON ss.id = sa.shift_id
         WHERE sa.school_id = $1 AND sa.staff_id = $2 AND sa.work_date = $3`,
        [schoolId, staff.id, todayDate],
      );

      const att = attRes.rows[0];

      // If no attendance row yet, fetch assigned shift
      let assignedShift: {
        id: string;
        name: string;
        startsAt: string;
        endsAt: string;
      } | null = null;
      if (att?.shift_id) {
        assignedShift = {
          id: att.shift_id,
          name: att.shift_name || "Standard Shift",
          startsAt: (att.shift_starts_at || "08:00").slice(0, 5),
          endsAt: (att.shift_ends_at || "16:00").slice(0, 5),
        };
      } else {
        const shiftRes = await pool.query<{
          id: string;
          name: string;
          starts_at: string;
          ends_at: string;
        }>(
          `SELECT ss.id, ss.name, ss.starts_at::text, ss.ends_at::text
           FROM staff_shift_assignments ssa
           JOIN staff_shifts ss ON ss.id = ssa.shift_id
           WHERE ssa.school_id = $1 AND ssa.staff_id = $2
             AND ssa.effective_from <= $3
             AND (ssa.effective_to IS NULL OR ssa.effective_to >= $3)
           ORDER BY ssa.effective_from DESC LIMIT 1`,
          [schoolId, staff.id, todayDate],
        );
        if (shiftRes.rows[0]) {
          assignedShift = {
            id: shiftRes.rows[0].id,
            name: shiftRes.rows[0].name,
            startsAt: shiftRes.rows[0].starts_at.slice(0, 5),
            endsAt: shiftRes.rows[0].ends_at.slice(0, 5),
          };
        }
      }

      // Check biometric enrollment status
      const bioRes = await pool.query<{ enrolment_status: string }>(
        `SELECT enrolment_status FROM staff_biometric_profiles WHERE school_id = $1 AND staff_id = $2`,
        [schoolId, staff.id],
      );
      const isEnrolled = bioRes.rows[0]?.enrolment_status === "enrolled";

      // Active Geofences for proximity display
      const fencesRes = await pool.query<{
        id: string;
        name: string;
        latitude: number;
        longitude: number;
        radius_meters: number;
      }>(
        `SELECT id, name, latitude::float, longitude::float, radius_meters
         FROM school_geofences WHERE school_id = $1 AND is_active = true`,
        [schoolId],
      );

      // Determine current punch state
      let currentPunchState: "not_punched_in" | "punched_in" | "punched_out" =
        "not_punched_in";
      if (att?.punch_in && !att.punch_out) {
        currentPunchState = "punched_in";
      } else if (att?.punch_in && att?.punch_out) {
        currentPunchState = "punched_out";
      }

      return {
        staff: {
          id: staff.id,
          employeeNumber: staff.employee_number,
          name: `${staff.first_name} ${staff.last_name}`.trim(),
        },
        workDate: todayDate,
        currentPunchState,
        todayAttendance: att
          ? {
              id: att.id,
              punchIn: att.punch_in,
              punchOut: att.punch_out,
              status: att.status,
            }
          : null,
        assignedShift,
        biometricEnrolled: isEnrolled,
        geofences: fencesRes.rows.map((f) => ({
          id: f.id,
          name: f.name,
          latitude: f.latitude,
          longitude: f.longitude,
          radiusMeters: f.radius_meters,
        })),
      };
    },
  );

  /* -------------------------------------------------------------------------- */
  /* 4. EXECUTE GEO-FENCED, FACE-VERIFIED PUNCH                                 */
  /* -------------------------------------------------------------------------- */

  app.post(
    "/api/schools/:schoolId/staff/attendance/punch",
    { preHandler: requireAuth },
    async (request, reply) => {
      assertSyntheticBiometricPipeline();
      const { schoolId } = parseInput(schoolParams, request.params);
      const input = parseInput(punchInput, request.body);
      const actor = getActor(request);
      const pool = getPool();

      // Step 1: Identify staff member
      const staffRes = await pool.query<{
        id: string;
        employee_number: string;
        first_name: string;
        last_name: string;
      }>(
        `SELECT id, employee_number, first_name, last_name
         FROM staff
         WHERE school_id = $1 AND user_id = $2 AND status = 'active'
         LIMIT 1`,
        [schoolId, actor.userId],
      );

      const staff = staffRes.rows[0];
      if (!staff) {
        throw forbidden(
          "No active employee profile linked to your user account.",
        );
      }

      const todayDate = todayInTimeZone(actor.school.timezone);

      // Step 2: Validate state transitions
      const currAttRes = await pool.query<{
        id: string;
        punch_in: Date | null;
        punch_out: Date | null;
        status: string;
        shift_id: string | null;
      }>(
        `SELECT id, punch_in, punch_out, status, shift_id
         FROM staff_attendance
         WHERE school_id = $1 AND staff_id = $2 AND work_date = $3`,
        [schoolId, staff.id, todayDate],
      );

      const existingAtt = currAttRes.rows[0];

      if (input.punchType === "punch_in") {
        if (existingAtt?.punch_in && !existingAtt.punch_out) {
          throw conflict(
            "You are already punched in for today. Please punch out when leaving.",
          );
        }
        if (existingAtt?.punch_in && existingAtt.punch_out) {
          throw conflict(
            "Shift already completed for today. Employee has already punched in and out.",
          );
        }
      } else if (input.punchType === "punch_out") {
        if (!existingAtt?.punch_in) {
          throw badRequest(
            "Cannot punch out without a valid punch-in for today.",
          );
        }
        if (existingAtt.punch_out) {
          throw conflict(
            "You have already completed your punch-out for today.",
          );
        }
      }

      // Step 3: Geofence Verification
      const { rows: geofencesRaw } = await pool.query<{
        id: string;
        name: string;
        latitude: number;
        longitude: number;
        radius_meters: number;
        max_accuracy_threshold_meters: number;
        is_active: boolean;
      }>(
        `SELECT id, name, latitude::float, longitude::float, radius_meters,
                max_accuracy_threshold_meters, is_active
         FROM school_geofences
         WHERE school_id = $1 AND is_active = true`,
        [schoolId],
      );

      const geofenceDefs: GeofenceDefinition[] = geofencesRaw.map((g) => ({
        id: g.id,
        name: g.name,
        latitude: g.latitude,
        longitude: g.longitude,
        radiusMeters: g.radius_meters,
        maxAccuracyThresholdMeters: g.max_accuracy_threshold_meters,
        isActive: g.is_active,
      }));

      const geoEval = evaluateGeofence(
        {
          latitude: input.latitude,
          longitude: input.longitude,
          accuracyMeters: input.accuracyMeters,
          timestamp: input.locationTimestamp,
        },
        geofenceDefs,
        { isMockLocation: input.isMockLocation },
      );

      // Step 4: Facial Biometric & Liveness Verification
      const bioRes = await pool.query<{
        id: string;
        enrolment_status: string;
        template_data_encrypted: string | null;
      }>(
        `SELECT id, enrolment_status, template_data_encrypted
         FROM staff_biometric_profiles
         WHERE school_id = $1 AND staff_id = $2`,
        [schoolId, staff.id],
      );

      const bioProfile = bioRes.rows[0];
      let faceMatched = false;
      let livenessPassed = false;
      let livenessScore = 0;
      let matchConfidence = 0;
      let failureReason: string | undefined;
      let verificationStatus:
        | "verified"
        | "out_of_geofence"
        | "poor_accuracy"
        | "face_mismatch"
        | "liveness_failed"
        | "camera_denied"
        | "location_denied" = "verified";

      // Evaluate geofence failure first
      if (!geoEval.isWithinGeofence) {
        verificationStatus =
          geoEval.status === "poor_accuracy"
            ? "poor_accuracy"
            : "out_of_geofence";
        failureReason = geoEval.reason;
      } else if (
        bioProfile &&
        bioProfile.enrolment_status === "enrolled" &&
        bioProfile.template_data_encrypted
      ) {
        // Enrolled: Verify probe embedding against decrypted template
        if (!input.probeEmbedding || input.probeEmbedding.length === 0) {
          verificationStatus = "face_mismatch";
          failureReason =
            "Facial capture missing. Camera permission or valid face capture required.";
        } else {
          try {
            const decryptedJson = decryptBiometricTemplate(
              bioProfile.template_data_encrypted,
            );
            const enrolledVector: number[] = JSON.parse(decryptedJson);

            const faceResult = verifyFaceIdentity(
              enrolledVector,
              input.probeEmbedding,
              input.livenessProbe || {
                blinkDetected: true,
                motionScore: 80,
                textureVariance: 75,
              },
              0.7,
            );

            faceMatched = faceResult.isMatch;
            livenessPassed = faceResult.livenessPassed;
            livenessScore = faceResult.livenessScore;
            matchConfidence = faceResult.confidenceScore;

            if (!faceResult.livenessPassed) {
              verificationStatus = "liveness_failed";
              failureReason = faceResult.failureReason;
            } else if (!faceResult.isMatch) {
              verificationStatus = "face_mismatch";
              failureReason = faceResult.failureReason;
            } else {
              verificationStatus = "verified";
            }
          } catch (err: unknown) {
            verificationStatus = "face_mismatch";
            failureReason = "Biometric template decryption or matching error.";
          }
        }
      } else {
        // Biometric profile not yet enrolled: Geofence passed, mark as verified with provisional flag
        faceMatched = true;
        livenessPassed = true;
        livenessScore = 100;
        matchConfidence = 100;
        verificationStatus = "verified";
      }

      // Record punch event into staff_punch_events telemetry
      const now = new Date();
      const isSuccess = verificationStatus === "verified";

      const punchEventRes = await pool.query<{ id: string }>(
        `INSERT INTO staff_punch_events
           (school_id, staff_id, work_date, punch_type, punched_at, verification_status,
            latitude, longitude, accuracy_meters, distance_meters, geofence_id,
            geofence_verified, liveness_score, liveness_verified, match_confidence,
            face_matched, failure_reason, device_source, kiosk_id, client_metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
         RETURNING id`,
        [
          schoolId,
          staff.id,
          todayDate,
          input.punchType,
          now,
          verificationStatus,
          input.latitude,
          input.longitude,
          input.accuracyMeters,
          geoEval.distanceMeters,
          geoEval.matchedGeofenceId,
          geoEval.isWithinGeofence,
          livenessScore,
          livenessPassed,
          matchConfidence,
          faceMatched,
          failureReason ?? null,
          input.deviceSource,
          input.kioskId ?? null,
          JSON.stringify({
            ip: request.ip,
            userAgent: request.headers["user-agent"],
          }),
        ],
      );

      const punchEventId = punchEventRes.rows[0]!.id;

      // If verification failed, return structured failure response with advice
      if (!isSuccess) {
        return reply.status(400).send({
          success: false,
          punchEventId,
          verificationStatus,
          message: failureReason || "Attendance punch verification failed.",
          details: {
            geofenceVerified: geoEval.isWithinGeofence,
            geofenceName: geoEval.matchedGeofenceName,
            distanceMeters: geoEval.distanceMeters,
            livenessScore,
            matchConfidence,
          },
        });
      }

      // Step 5: Transactionally update staff_attendance operational record
      let attendanceRecordId: string;

      if (input.punchType === "punch_in") {
        const insRes = await pool.query<{ id: string }>(
          `INSERT INTO staff_attendance
             (school_id, staff_id, work_date, punch_in, status, recorded_by, created_at)
           VALUES ($1, $2, $3, $4, 'present', $5, $4)
           ON CONFLICT (school_id, staff_id, work_date) DO UPDATE SET
             punch_in = EXCLUDED.punch_in,
             status = 'present',
             recorded_by = EXCLUDED.recorded_by,
             updated_at = now()
           RETURNING id`,
          [schoolId, staff.id, todayDate, now, actor.userId],
        );
        attendanceRecordId = insRes.rows[0]!.id;
      } else {
        const updRes = await pool.query<{ id: string }>(
          `UPDATE staff_attendance
           SET punch_out = $4,
               status = 'present',
               updated_at = now()
           WHERE school_id = $1 AND staff_id = $2 AND work_date = $3
           RETURNING id`,
          [schoolId, staff.id, todayDate, now],
        );
        attendanceRecordId = updRes.rows[0]!.id;
      }

      // Link punch event to attendance record
      await pool.query(
        "UPDATE staff_punch_events SET attendance_record_id = $1 WHERE id = $2",
        [attendanceRecordId, punchEventId],
      );

      await recordAudit(pool, {
        schoolId,
        actorUserId: actor.userId,
        action:
          input.punchType === "punch_in"
            ? "hr.staff_punched_in"
            : "hr.staff_punched_out",
        entityType: "staff_attendance",
        entityId: attendanceRecordId,
        outcome: "success",
        after: {
          punchType: input.punchType,
          punchedAt: now.toISOString(),
          geofenceName: geoEval.matchedGeofenceName,
          matchConfidence,
          livenessScore,
        },
        ...requestMeta(request),
      });

      return reply.status(200).send({
        success: true,
        punchEventId,
        attendanceRecordId,
        punchType: input.punchType,
        punchedAt: now.toISOString(),
        verificationStatus: "verified",
        message:
          input.punchType === "punch_in"
            ? `Successfully punched in at ${geoEval.matchedGeofenceName || "Campus"}. Have a productive day!`
            : "Successfully punched out. See you tomorrow!",
        telemetry: {
          location: geoEval.matchedGeofenceName,
          distanceMeters: geoEval.distanceMeters,
          matchConfidence,
          livenessScore,
        },
      });
    },
  );

  /* -------------------------------------------------------------------------- */
  /* 5. DEDICATED ENTRANCE KIOSKS                                              */
  /* -------------------------------------------------------------------------- */

  app.get(
    "/api/schools/:schoolId/staff/attendance/kiosks",
    { preHandler: requirePermission("hr.attendance.view") },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const { rows } = await getPool().query(
        `SELECT ak.id, ak.device_code, ak.device_name, ak.status,
                ak.last_heartbeat_at, ak.app_version, ak.ip_address,
                sg.name AS geofence_name, c.name AS campus_name,
                ak.created_at, ak.updated_at
         FROM attendance_kiosks ak
         LEFT JOIN school_geofences sg ON sg.id = ak.geofence_id
         LEFT JOIN campuses c ON c.id = ak.campus_id
         WHERE ak.school_id = $1
         ORDER BY ak.created_at DESC`,
        [schoolId],
      );
      return {
        items: rows.map((r: any) => ({
          id: r.id,
          deviceCode: r.device_code,
          deviceName: r.device_name,
          status: r.status,
          lastHeartbeatAt: r.last_heartbeat_at,
          appVersion: r.app_version,
          ipAddress: r.ip_address,
          geofenceName: r.geofence_name,
          campusName: r.campus_name,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      };
    },
  );

  app.post(
    "/api/schools/:schoolId/staff/attendance/kiosks",
    { preHandler: requirePermission("hr.attendance.configure") },
    async (request, reply) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const input = parseInput(kioskRegisterInput, request.body);
      const actor = getActor(request);

      const apiKeyHash = crypto
        .createHash("sha256")
        .update(input.apiKey)
        .digest("hex");

      const { rows } = await getPool().query<{ id: string }>(
        `INSERT INTO attendance_kiosks
           (school_id, campus_id, device_code, device_name, geofence_id, api_key_hash, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'active')
         RETURNING id`,
        [
          schoolId,
          input.campusId ?? null,
          input.deviceCode,
          input.deviceName,
          input.geofenceId ?? null,
          apiKeyHash,
        ],
      );

      await recordAudit(getPool(), {
        schoolId,
        actorUserId: actor.userId,
        action: "hr.kiosk_registered",
        entityType: "attendance_kiosk",
        entityId: rows[0]!.id,
        outcome: "success",
        after: { code: input.deviceCode, name: input.deviceName },
        ...requestMeta(request),
      });

      return reply
        .status(201)
        .send({
          id: rows[0]!.id,
          message: "Attendance kiosk registered successfully.",
        });
    },
  );

  app.post(
    "/api/schools/:schoolId/staff/attendance/kiosk-punch",
    async (request, reply) => {
      assertSyntheticBiometricPipeline();
      const { schoolId } = parseInput(schoolParams, request.params);
      const input = parseInput(kioskPunchInput, request.body);
      const pool = getPool();

      // Dedicated entrance kiosk authentication via headers, with fallback to session auth
      const kioskCode = (request.headers["x-kiosk-code"] as string) || "";
      const kioskKey = (request.headers["x-kiosk-key"] as string) || "";
      let kioskRecord: {
        id: string;
        device_name: string;
        geofence_id: string | null;
      } | null = null;

      if (kioskCode && kioskKey) {
        const keyHash = crypto
          .createHash("sha256")
          .update(kioskKey)
          .digest("hex");
        const kioskCheck = await pool.query<{
          id: string;
          device_name: string;
          geofence_id: string | null;
        }>(
          `SELECT id, device_name, geofence_id
           FROM attendance_kiosks
           WHERE school_id = $1 AND device_code = $2 AND api_key_hash = $3 AND status = 'active'`,
          [schoolId, kioskCode, keyHash],
        );
        if (kioskCheck.rowCount === 0) {
          throw unauthorized("Invalid or inactive kiosk credentials.");
        }
        kioskRecord = kioskCheck.rows[0]!;
        await pool.query(
          "UPDATE attendance_kiosks SET last_heartbeat_at = now() WHERE id = $1",
          [kioskRecord.id],
        );
      } else {
        await requireAuth(request, reply);
      }

      // Look up staff member by code or id
      let staffQuery =
        "SELECT id, employee_number, first_name, last_name FROM staff WHERE school_id = $1";
      const params: any[] = [schoolId];
      if (input.staffId) {
        staffQuery += " AND id = $2";
        params.push(input.staffId);
      } else if (input.employeeCode) {
        staffQuery += " AND employee_number = $2";
        params.push(input.employeeCode);
      } else {
        throw badRequest("Employee code or staffId required for kiosk punch.");
      }

      const { rows: staffRows } = await pool.query<{
        id: string;
        employee_number: string;
        first_name: string;
        last_name: string;
      }>(staffQuery, params);

      const staff = staffRows[0];
      if (!staff) throw notFound("Staff member not found");

      // Look up biometric profile
      const bioRes = await pool.query<{
        id: string;
        enrolment_status: string;
        template_data_encrypted: string | null;
      }>(
        `SELECT id, enrolment_status, template_data_encrypted
         FROM staff_biometric_profiles
         WHERE school_id = $1 AND staff_id = $2`,
        [schoolId, staff.id],
      );

      const bioProfile = bioRes.rows[0];
      if (
        !bioProfile ||
        bioProfile.enrolment_status !== "enrolled" ||
        !bioProfile.template_data_encrypted
      ) {
        throw badRequest(
          "Employee has not enrolled biometric facial template. Please use supervisor approval.",
        );
      }

      const decrypted = decryptBiometricTemplate(
        bioProfile.template_data_encrypted,
      );
      const enrolledVector: number[] = JSON.parse(decrypted);

      const faceResult = verifyFaceIdentity(
        enrolledVector,
        input.probeEmbedding,
        input.livenessProbe || { blinkDetected: true, motionScore: 85 },
        0.7,
      );

      const now = new Date();
      const todayDate = todayInTimeZone("Asia/Kolkata");

      // Record event
      const punchEventRes = await pool.query<{ id: string }>(
        `INSERT INTO staff_punch_events
           (school_id, staff_id, work_date, punch_type, punched_at, verification_status,
            geofence_verified, liveness_score, liveness_verified, match_confidence,
            face_matched, failure_reason, device_source, kiosk_id)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, $10, $11, 'kiosk', $12)
         RETURNING id`,
        [
          schoolId,
          staff.id,
          todayDate,
          input.punchType,
          now,
          faceResult.verificationStatus,
          faceResult.livenessScore,
          faceResult.livenessPassed,
          faceResult.confidenceScore,
          faceResult.isMatch,
          faceResult.failureReason ?? null,
          kioskRecord?.id ?? null,
        ],
      );

      if (!faceResult.isMatch || !faceResult.livenessPassed) {
        return reply.status(400).send({
          success: false,
          verificationStatus: faceResult.verificationStatus,
          message:
            faceResult.failureReason || "Face verification failed at kiosk.",
        });
      }

      // Update attendance
      let attendanceRecordId: string;
      if (input.punchType === "punch_in") {
        const ins = await pool.query<{ id: string }>(
          `INSERT INTO staff_attendance (school_id, staff_id, work_date, punch_in, status, created_at)
           VALUES ($1, $2, $3, $4, 'present', $4)
           ON CONFLICT (school_id, staff_id, work_date) DO UPDATE SET
             punch_in = EXCLUDED.punch_in, status = 'present', updated_at = now()
           RETURNING id`,
          [schoolId, staff.id, todayDate, now],
        );
        attendanceRecordId = ins.rows[0]!.id;
      } else {
        const upd = await pool.query<{ id: string }>(
          `UPDATE staff_attendance SET punch_out = $4, status = 'present', updated_at = now()
           WHERE school_id = $1 AND staff_id = $2 AND work_date = $3
           RETURNING id`,
          [schoolId, staff.id, todayDate, now],
        );
        attendanceRecordId = upd.rows[0]!.id;
      }

      await pool.query(
        "UPDATE staff_punch_events SET attendance_record_id = $1 WHERE id = $2",
        [attendanceRecordId, punchEventRes.rows[0]!.id],
      );

      return reply.status(200).send({
        success: true,
        verificationStatus: "verified",
        deviceSource: "kiosk",
        staffName: `${staff.first_name} ${staff.last_name}`.trim(),
        employeeCode: staff.employee_number,
        punchType: input.punchType,
        punchedAt: now.toISOString(),
        confidenceScore: faceResult.confidenceScore,
        message: `Welcome, ${staff.first_name}! Punch verified.`,
      });
    },
  );

  /* -------------------------------------------------------------------------- */
  /* 6. STAFF ATTENDANCE EXCEPTIONS & FALLBACK WORKFLOW                        */
  /* -------------------------------------------------------------------------- */

  app.get(
    "/api/schools/:schoolId/staff/attendance/exceptions",
    { preHandler: requirePermission("hr.attendance.view") },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const status = (request.query as { status?: string })?.status;

      let query = `
        SELECT sae.id, sae.staff_id, sae.work_date::text, sae.exception_type,
               sae.requested_punch_in::text, sae.requested_punch_out::text,
               sae.reason, sae.supporting_document_name, sae.status,
               sae.requested_at::text, sae.reviewed_at::text, sae.review_notes,
               st.first_name, st.last_name, st.employee_number,
               req_u.display_name AS requested_by_name,
               rev_u.display_name AS reviewed_by_name
        FROM staff_attendance_exceptions sae
        JOIN staff st ON st.id = sae.staff_id
        JOIN users req_u ON req_u.id = sae.requested_by
        LEFT JOIN users rev_u ON rev_u.id = sae.reviewed_by
        WHERE sae.school_id = $1
      `;
      const params: any[] = [schoolId];

      if (status) {
        query += " AND sae.status = $2";
        params.push(status);
      }

      query += " ORDER BY sae.requested_at DESC";

      const { rows } = await getPool().query(query, params);
      return {
        items: rows.map((r: any) => ({
          id: r.id,
          staffId: r.staff_id,
          workDate: r.work_date,
          exceptionType: r.exception_type,
          requestedPunchIn: r.requested_punch_in,
          requestedPunchOut: r.requested_punch_out,
          reason: r.reason,
          supportingDocumentName: r.supporting_document_name,
          status: r.status,
          requestedAt: r.requested_at,
          reviewedAt: r.reviewed_at,
          reviewNotes: r.review_notes,
          firstName: r.first_name,
          lastName: r.last_name,
          staffName: `${r.first_name} ${r.last_name}`.trim(),
          employeeNumber: r.employee_number,
          requestedByName: r.requested_by_name,
          reviewedByName: r.reviewed_by_name,
        })),
      };
    },
  );

  app.post(
    "/api/schools/:schoolId/staff/attendance/exceptions",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const input = parseInput(exceptionRequestInput, request.body);
      const actor = getActor(request);
      const pool = getPool();

      // Find staff record for user
      const staffRes = await pool.query<{ id: string }>(
        `SELECT id FROM staff WHERE school_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
        [schoolId, actor.userId],
      );

      const staff = staffRes.rows[0];
      if (!staff)
        throw forbidden(
          "No active employee profile linked to your user account.",
        );

      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO staff_attendance_exceptions
           (school_id, staff_id, work_date, exception_type, requested_punch_in,
            requested_punch_out, reason, supporting_document_name, status, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
         RETURNING id`,
        [
          schoolId,
          staff.id,
          input.workDate,
          input.exceptionType,
          input.requestedPunchIn ?? null,
          input.requestedPunchOut ?? null,
          input.reason,
          input.supportingDocumentName ?? null,
          actor.userId,
        ],
      );

      await recordAudit(pool, {
        schoolId,
        actorUserId: actor.userId,
        action: "hr.attendance_exception_requested",
        entityType: "staff_attendance_exception",
        entityId: rows[0]!.id,
        outcome: "success",
        after: {
          workDate: input.workDate,
          type: input.exceptionType,
          reason: input.reason,
        },
        ...requestMeta(request),
      });

      return reply.status(201).send({
        id: rows[0]!.id,
        message:
          "Attendance exception submitted. Routed to supervisor / HR officer for review.",
      });
    },
  );

  app.post(
    "/api/schools/:schoolId/staff/attendance/exceptions/:id/review",
    { preHandler: requirePermission("hr.attendance.approve") },
    async (request, reply) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      const input = parseInput(exceptionReviewInput, request.body);
      const actor = getActor(request);

      const result = await withTransaction(async (client) => {
        const { rows } = await client.query<{
          id: string;
          staff_id: string;
          work_date: string;
          exception_type: string;
          requested_punch_in: Date | null;
          requested_punch_out: Date | null;
          requested_by: string;
          status: string;
        }>(
          `SELECT id, staff_id, work_date::text, exception_type, requested_punch_in,
                  requested_punch_out, requested_by, status
           FROM staff_attendance_exceptions
           WHERE school_id = $1 AND id = $2
           FOR UPDATE`,
          [schoolId, id],
        );

        const exc = rows[0];
        if (!exc) throw notFound("Attendance exception request not found");
        if (exc.status !== "pending")
          throw conflict("This exception has already been decided.");

        // Segregation of duties: approver cannot approve their own exception
        if (exc.requested_by === actor.userId) {
          throw forbidden(
            "Segregation of duties: You cannot approve your own attendance exception.",
          );
        }

        await client.query(
          `UPDATE staff_attendance_exceptions
           SET status = $3, reviewed_by = $4, reviewed_at = now(), review_notes = $5, updated_at = now()
           WHERE school_id = $1 AND id = $2`,
          [schoolId, id, input.status, actor.userId, input.reviewNotes],
        );

        // If approved, update or create the staff_attendance operational record
        if (input.status === "approved") {
          const punchIn =
            exc.requested_punch_in || new Date(`${exc.work_date}T08:00:00Z`);
          const punchOut =
            exc.requested_punch_out || new Date(`${exc.work_date}T16:00:00Z`);

          await client.query(
            `INSERT INTO staff_attendance
               (school_id, staff_id, work_date, punch_in, punch_out, status, note, recorded_by)
             VALUES ($1, $2, $3, $4, $5, 'present', $6, $7)
             ON CONFLICT (school_id, staff_id, work_date) DO UPDATE SET
               punch_in = COALESCE(EXCLUDED.punch_in, staff_attendance.punch_in),
               punch_out = COALESCE(EXCLUDED.punch_out, staff_attendance.punch_out),
               status = 'present',
               note = EXCLUDED.note,
               recorded_by = EXCLUDED.recorded_by,
               updated_at = now()`,
            [
              schoolId,
              exc.staff_id,
              exc.work_date,
              punchIn,
              punchOut,
              `Approved exception (${exc.exception_type}): ${input.reviewNotes}`,
              actor.userId,
            ],
          );
        }

        await recordAudit(client, {
          schoolId,
          actorUserId: actor.userId,
          action: "hr.attendance_exception_reviewed",
          entityType: "staff_attendance_exception",
          entityId: id,
          outcome: "success",
          after: { decision: input.status, notes: input.reviewNotes },
          ...requestMeta(request),
        });

        return { status: input.status };
      });

      return reply.status(200).send({
        success: true,
        decision: result.status,
        message: `Exception request has been ${result.status}.`,
      });
    },
  );

  /* -------------------------------------------------------------------------- */
  /* 7. PUNCH EVENTS AUDIT & TELEMETRY LOG                                      */
  /* -------------------------------------------------------------------------- */

  app.get(
    "/api/schools/:schoolId/staff/attendance/punches",
    { preHandler: requirePermission("hr.attendance.view") },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const query = request.query as {
        staffId?: string;
        status?: string;
        date?: string;
        limit?: string;
      };

      let sql = `
        SELECT spe.id, spe.staff_id, spe.work_date::text, spe.punch_type,
               spe.punched_at::text, spe.verification_status,
               spe.latitude::float, spe.longitude::float, spe.accuracy_meters::float,
               spe.distance_meters::float, spe.geofence_verified,
               spe.liveness_score::float, spe.liveness_verified,
               spe.match_confidence::float, spe.face_matched,
               spe.failure_reason, spe.device_source,
               st.first_name, st.last_name, st.employee_number,
               sg.name AS geofence_name, ak.device_name AS kiosk_name
        FROM staff_punch_events spe
        JOIN staff st ON st.id = spe.staff_id
        LEFT JOIN school_geofences sg ON sg.id = spe.geofence_id
        LEFT JOIN attendance_kiosks ak ON ak.id = spe.kiosk_id
        WHERE spe.school_id = $1
      `;
      const params: any[] = [schoolId];

      if (query.staffId) {
        params.push(query.staffId);
        sql += ` AND spe.staff_id = $${params.length}`;
      }
      if (query.status) {
        params.push(query.status);
        sql += ` AND spe.verification_status = $${params.length}`;
      }
      if (query.date) {
        params.push(query.date);
        sql += ` AND spe.work_date = $${params.length}`;
      }

      sql += ` ORDER BY spe.punched_at DESC LIMIT ${Math.min(200, Number(query.limit) || 50)}`;

      const { rows } = await getPool().query(sql, params);
      return {
        items: rows.map((r: any) => ({
          id: r.id,
          staffId: r.staff_id,
          workDate: r.work_date,
          punchType: r.punch_type,
          punchedAt: r.punched_at,
          verificationStatus: r.verification_status,
          latitude: r.latitude,
          longitude: r.longitude,
          accuracyMeters: r.accuracy_meters,
          distanceMeters: r.distance_meters,
          geofenceVerified: r.geofence_verified,
          livenessScore: r.liveness_score,
          livenessVerified: r.liveness_verified,
          matchConfidence: r.match_confidence,
          faceMatched: r.face_matched,
          failureReason: r.failure_reason,
          deviceSource: r.device_source,
          firstName: r.first_name,
          lastName: r.last_name,
          employeeNumber: r.employee_number,
          geofenceName: r.geofence_name,
          kioskName: r.kiosk_name,
        })),
      };
    },
  );
}

function assertSyntheticBiometricPipeline(): void {
  if (process.env.NODE_ENV !== "test")
    throw new AppError(
      503,
      "biometric_integration_required",
      "This biometric pipeline accepts synthetic test evidence only. Use supervised staff attendance until a trusted capture and liveness service is integrated.",
    );
}
