import crypto from "node:crypto";

export interface Coordinates {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  timestamp?: number;
}

export interface GeofenceDefinition {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  maxAccuracyThresholdMeters: number;
  isActive: boolean;
}

export interface GeofenceEvaluation {
  isWithinGeofence: boolean;
  status:
    "verified" | "out_of_geofence" | "poor_accuracy" | "mock_location_detected";
  matchedGeofenceId: string | null;
  matchedGeofenceName: string | null;
  distanceMeters: number;
  accuracyMeters: number;
  reason?: string;
}

export interface LivenessProbe {
  blinkDetected?: boolean;
  motionScore?: number; // 0-100
  textureVariance?: number; // 0-100
  antiReplayToken?: string;
  challengeResponseTimeMs?: number;
  spoofProbability?: number; // 0-100
}

export interface FaceVerificationResult {
  isMatch: boolean;
  confidenceScore: number; // 0-100
  livenessPassed: boolean;
  livenessScore: number; // 0-100
  verificationStatus: "verified" | "face_mismatch" | "liveness_failed";
  failureReason?: string;
}

const EARTH_RADIUS_METERS = 6371000;

/**
 * Calculates geodesic distance between two latitude/longitude points in meters using Haversine formula.
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_METERS * c * 10) / 10;
}

/**
 * Evaluates whether device coordinates fall within any active school geofence.
 */
export function evaluateGeofence(
  coords: Coordinates,
  geofences: GeofenceDefinition[],
  options?: {
    isMockLocation?: boolean;
    previousPunch?: { lat: number; lon: number; time: number };
  },
): GeofenceEvaluation {
  const accuracy = coords.accuracyMeters ?? 15;

  // 1. Detect mock location flags where reported by device
  if (options?.isMockLocation) {
    return {
      isWithinGeofence: false,
      status: "mock_location_detected",
      matchedGeofenceId: null,
      matchedGeofenceName: null,
      distanceMeters: 9999,
      accuracyMeters: accuracy,
      reason: "Mock location provider or simulated GPS coordinates detected",
    };
  }

  // 2. Check for impossible velocity jumps from previous punch
  if (options?.previousPunch && coords.timestamp) {
    const elapsedSecs = Math.max(
      1,
      (coords.timestamp - options.previousPunch.time) / 1000,
    );
    const jumpDistance = haversineDistanceMeters(
      options.previousPunch.lat,
      options.previousPunch.lon,
      coords.latitude,
      coords.longitude,
    );
    const speedMps = jumpDistance / elapsedSecs;
    if (speedMps > 300 && jumpDistance > 1000) {
      // > 1000 km/h jump between punches
      return {
        isWithinGeofence: false,
        status: "mock_location_detected",
        matchedGeofenceId: null,
        matchedGeofenceName: null,
        distanceMeters: jumpDistance,
        accuracyMeters: accuracy,
        reason: `Impossible location jump: ${Math.round(jumpDistance)}m in ${Math.round(elapsedSecs)}s`,
      };
    }
  }

  const activeGeofences = geofences.filter((g) => g.isActive);
  if (activeGeofences.length === 0) {
    return {
      isWithinGeofence: false,
      status: "out_of_geofence",
      matchedGeofenceId: null,
      matchedGeofenceName: null,
      distanceMeters: 9999,
      accuracyMeters: accuracy,
      reason: "No active geofences configured for this campus",
    };
  }

  let closestFence: GeofenceDefinition | null = null;
  let minDistance = Number.POSITIVE_INFINITY;

  for (const fence of activeGeofences) {
    const dist = haversineDistanceMeters(
      coords.latitude,
      coords.longitude,
      fence.latitude,
      fence.longitude,
    );
    if (dist < minDistance) {
      minDistance = dist;
      closestFence = fence;
    }
  }

  if (!closestFence) {
    return {
      isWithinGeofence: false,
      status: "out_of_geofence",
      matchedGeofenceId: null,
      matchedGeofenceName: null,
      distanceMeters: 9999,
      accuracyMeters: accuracy,
      reason: "Outside all authorized school attendance areas",
    };
  }

  // Check accuracy threshold
  if (accuracy > closestFence.maxAccuracyThresholdMeters) {
    return {
      isWithinGeofence: false,
      status: "poor_accuracy",
      matchedGeofenceId: closestFence.id,
      matchedGeofenceName: closestFence.name,
      distanceMeters: minDistance,
      accuracyMeters: accuracy,
      reason: `GPS accuracy (${accuracy}m) is insufficient. Maximum allowed is ${closestFence.maxAccuracyThresholdMeters}m. Please move to an open area.`,
    };
  }

  // Check radius boundary
  if (minDistance <= closestFence.radiusMeters) {
    return {
      isWithinGeofence: true,
      status: "verified",
      matchedGeofenceId: closestFence.id,
      matchedGeofenceName: closestFence.name,
      distanceMeters: minDistance,
      accuracyMeters: accuracy,
    };
  }

  return {
    isWithinGeofence: false,
    status: "out_of_geofence",
    matchedGeofenceId: closestFence.id,
    matchedGeofenceName: closestFence.name,
    distanceMeters: minDistance,
    accuracyMeters: accuracy,
    reason: `Outside authorized geofence for ${closestFence.name} (distance: ${Math.round(minDistance)}m, permitted: ${closestFence.radiusMeters}m)`,
  };
}

/**
 * Computes cosine similarity between two normalized mathematical feature vectors.
 */
export function cosineSimilarity(v1: number[], v2: number[]): number {
  if (v1.length === 0 || v1.length !== v2.length) return 0;
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < v1.length; i++) {
    const a = v1[i]!;
    const b = v2[i]!;
    dotProduct += a * b;
    norm1 += a * a;
    norm2 += b * b;
  }

  if (norm1 === 0 || norm2 === 0) return 0;
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * Evaluates liveness and anti-spoofing indicators from a verification attempt.
 */
export function evaluateLiveness(probe: LivenessProbe): {
  livenessPassed: boolean;
  livenessScore: number;
  reason?: string;
} {
  // Liveness score based on multi-cue anti-spoofing
  let score = 0;

  // 1. Motion score (natural micro-movements across consecutive frames)
  const motion = probe.motionScore ?? 85;
  if (motion > 20 && motion < 98) {
    score += 40; // Natural head micro-movement
  } else if (motion <= 20) {
    // Static photo / paper printout
    score += 5;
  }

  // 2. Texture & frequency variance (detects paper/screen moire patterns)
  const texture = probe.textureVariance ?? 80;
  if (texture > 40) {
    score += 30; // Natural skin reflectance
  } else {
    score += 10;
  }

  // 3. Challenge verification (eye blink or prompt response)
  if (probe.blinkDetected) {
    score += 30;
  } else if (probe.motionScore && probe.motionScore > 60) {
    score += 20;
  }

  // Penalty for high spoof probability flags
  if (probe.spoofProbability && probe.spoofProbability > 50) {
    score = Math.max(0, score - (probe.spoofProbability - 50) * 2);
  }

  const finalScore = Math.min(100, Math.max(0, Math.round(score)));
  const livenessPassed = finalScore >= 70;

  return {
    livenessPassed,
    livenessScore: finalScore,
    reason: livenessPassed
      ? undefined
      : `Liveness verification failed (score: ${finalScore}/100). Please blink or turn face slightly.`,
  };
}

/**
 * Verifies face identity against enrolled biometric template with liveness checks.
 */
export function verifyFaceIdentity(
  enrolledEmbedding: number[],
  probeEmbedding: number[],
  livenessProbe: LivenessProbe,
  similarityThreshold = 0.7,
): FaceVerificationResult {
  const liveness = evaluateLiveness(livenessProbe);
  if (!liveness.livenessPassed) {
    return {
      isMatch: false,
      confidenceScore: 0,
      livenessPassed: false,
      livenessScore: liveness.livenessScore,
      verificationStatus: "liveness_failed",
      failureReason: liveness.reason,
    };
  }

  const similarity = cosineSimilarity(enrolledEmbedding, probeEmbedding);
  const confidenceScore = Math.min(
    100,
    Math.max(0, Math.round(similarity * 100)),
  );
  const isMatch = similarity >= similarityThreshold;

  if (!isMatch) {
    return {
      isMatch: false,
      confidenceScore,
      livenessPassed: true,
      livenessScore: liveness.livenessScore,
      verificationStatus: "face_mismatch",
      failureReason: `Face identity does not match enrolled staff template (confidence: ${confidenceScore}%, threshold: ${Math.round(similarityThreshold * 100)}%)`,
    };
  }

  return {
    isMatch: true,
    confidenceScore,
    livenessPassed: true,
    livenessScore: liveness.livenessScore,
    verificationStatus: "verified",
  };
}

/**
 * Deterministically generates a biometric feature vector from an input string/buffer for test and mock enrollment.
 */
export function generateSyntheticBiometricEmbedding(
  seedText: string,
  dimensions = 128,
): number[] {
  const hash = crypto.createHash("sha256").update(seedText).digest();
  const vector: number[] = [];

  for (let i = 0; i < dimensions; i++) {
    const byte = hash[i % hash.length]!;
    const val = (byte / 255.0) * 2.0 - 1.0 + Math.sin(i * 0.1) * 0.2;
    vector.push(val);
  }

  // Normalize vector to unit length
  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm);
  return vector.map((v) => (norm > 0 ? v / norm : 0));
}

/**
 * Encrypts a biometric template string using AES-256-GCM.
 */
export function encryptBiometricTemplate(
  data: string,
  secretKeyHex?: string,
): string {
  const key = biometricKey(secretKeyHex);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(data, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted biometric template string.
 */
export function decryptBiometricTemplate(
  encryptedString: string,
  secretKeyHex?: string,
): string {
  const [ivHex, authTagHex, cipherText] = encryptedString.split(":");
  if (!ivHex || !authTagHex || !cipherText)
    throw new Error("Invalid encrypted biometric format");
  const key = biometricKey(secretKeyHex);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  let decrypted = decipher.update(cipherText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function biometricKey(explicit?: string): Buffer {
  const value = explicit ?? process.env.BIOMETRIC_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new Error(
      "A securely provisioned 32-byte BIOMETRIC_ENCRYPTION_KEY is required",
    );
  return Buffer.from(value, "hex");
}
