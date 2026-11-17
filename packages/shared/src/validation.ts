import { z } from 'zod';

/**
 * Universal Data Validation Engine for Indian School ERP
 * Enforces canonical formatting and validation rules across frontend, backend,
 * CSV imports and background tasks.
 */

/**
 * Indian Mobile Number Validator & Normalizer
 *
 * Rules:
 * - Standard Indian mobile numbers are 10 digits starting with 6, 7, 8, or 9.
 * - May optionally be prefixed with `+91`, `91`, or `0`.
 * - Spaces and hyphens are stripped during normalization.
 * - Rejects numbers that are not 10 digits long after stripping country prefix.
 * - Returns normalized E.164-style `+91XXXXXXXXXX` or 10-digit format.
 */
export function normalizeIndianMobile(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[\s\-().]/g, '');
  
  // Match +91, 91, or 0 prefix followed by 10 digits starting with 6-9
  const match = cleaned.match(/^(?:\+91|91|0)?([6-9]\d{9})$/);
  if (!match || !match[1]) return null;
  return `+91${match[1]}`;
}

export function isValidIndianMobile(raw: string): boolean {
  return normalizeIndianMobile(raw) !== null;
}

export const indianMobileSchema = z
  .string()
  .trim()
  .refine((val) => isValidIndianMobile(val), {
    message: 'Enter a valid 10-digit Indian mobile number (e.g. 9876543210 or +91 98765 43210)',
  })
  .transform((val) => normalizeIndianMobile(val)!);

/**
 * Indian Vehicle Registration Number Validator & Normalizer
 *
 * Formats supported:
 * 1. Standard State format:
 *    - Example: UP 58 P 6370, UP58P6370, DL 01 AB 1234, MH 12 CD 5678, KA 05 MC 1234
 *    - Pattern: 2-letter state code + 2-digit RTO + optional 1-3 letter series + 4-digit number
 * 2. Bharat (BH) Series:
 *    - Example: 23 BH 1234 AB, 22BH1234A
 *    - Pattern: 2-digit year + 'BH' + 4-digit number + 1-2 letters
 *
 * Normalizes to standard uppercase spaced format: e.g. "UP 58 P 6370", "23 BH 1234 AB"
 */
const INDIAN_STATES_AND_UTS = new Set([
  'AN', 'AP', 'AR', 'AS', 'BR', 'CH', 'CG', 'CH', 'DD', 'DL', 'DN', 'GA',
  'GJ', 'HR', 'HP', 'JH', 'JK', 'KA', 'KL', 'LA', 'LD', 'MP', 'MH', 'MN',
  'ML', 'MZ', 'NL', 'OD', 'OR', 'PB', 'PY', 'RJ', 'SK', 'TN', 'TS', 'TR',
  'UP', 'UK', 'UA', 'WB'
]);

export function normalizeIndianVehicleNumber(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim().toUpperCase().replace(/[\s\-.]/g, '');

  // 1. Check Bharat Series (BH): e.g. 23BH1234AB
  const bhMatch = cleaned.match(/^(\d{2})(BH)(\d{4})([A-Z]{1,2})$/);
  if (bhMatch && Number(bhMatch[1])>=21 && Number(bhMatch[3])>0 && bhMatch[1] && bhMatch[2] && bhMatch[3] && bhMatch[4]) {
    return `${bhMatch[1]} BH ${bhMatch[3]} ${bhMatch[4]}`;
  }

  // 2. Check Standard State series: e.g. UP58P6370 or DL01AB1234 or KA051234 (without letter series)
  const stateMatch = cleaned.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/);
  if (stateMatch && Number(stateMatch[4])>0 && stateMatch[1] && stateMatch[2] && stateMatch[4]) {
    const stateCode = stateMatch[1];
    if (!INDIAN_STATES_AND_UTS.has(stateCode)) {
      return null;
    }
    const rto = stateMatch[2].padStart(2, '0');
    const series = stateMatch[3] ? ` ${stateMatch[3]}` : '';
    const number = stateMatch[4].padStart(4, '0');
    return `${stateCode} ${rto}${series} ${number}`;
  }

  return null;
}

export function isValidIndianVehicleNumber(raw: string): boolean {
  return normalizeIndianVehicleNumber(raw) !== null;
}

export const indianVehicleNumberSchema = z
  .string()
  .trim()
  .refine((val) => isValidIndianVehicleNumber(val), {
    message: 'Enter a valid Indian vehicle registration number (e.g. UP 58 P 6370 or 23 BH 1234 AB)',
  })
  .transform((val) => normalizeIndianVehicleNumber(val)!);

/**
 * Indian IFSC Code Validator
 * Format: 4 letters, then '0', then 6 alphanumeric characters.
 */
export function isValidIFSC(raw: string): boolean {
  if (!raw || typeof raw !== 'string') return null as unknown as boolean;
  const cleaned = raw.trim().toUpperCase();
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleaned);
}

export function formatIndianMobile(raw: string): string {
  const norm = normalizeIndianMobile(raw);
  if (!norm) return raw;
  const digits = norm.slice(3);
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

export function formatIndianVehicleNumber(raw: string): string {
  return normalizeIndianVehicleNumber(raw) || raw;
}

export const isValidIfsc = isValidIFSC;
export const isValidPinCode = isValidIndianPinCode;

export const ifscSchema = z
  .string()
  .trim()
  .transform((val) => val.toUpperCase())
  .refine((val) => isValidIFSC(val), {
    message: 'Enter a valid 11-character Indian IFSC code (e.g. SBIN0001234)',
  });

/**
 * Indian PIN Code (Postal Index Number) Validator
 * Format: 6 digits, first digit 1-9.
 */
export function isValidIndianPinCode(raw: string): boolean {
  if (!raw || typeof raw !== 'string') return false;
  return /^[1-9][0-9]{5}$/.test(raw.trim());
}

export const indianPinCodeSchema = z
  .string()
  .trim()
  .refine((val) => isValidIndianPinCode(val), {
    message: 'Enter a valid 6-digit Indian PIN code (e.g. 110001)',
  });

/**
 * Percentage Validator (0.00 to 100.00)
 */
export const percentageSchema = z.coerce
  .number()
  .min(0, 'Percentage cannot be negative')
  .max(100, 'Percentage cannot exceed 100');

/**
 * Money Amount Validator (NUMERIC(12, 2))
 */
export const moneyAmountSchema = z.coerce
  .number()
  .min(0, 'Amount must be non-negative')
  .max(999999999.99, 'Amount exceeds maximum permitted value')
  .transform((val) => Number(val.toFixed(2)));

/**
 * CBSE Roll Number Validator
 * Typically 7 to 8 digits
 */
export const cbseRollNumberSchema = z
  .string()
  .trim()
  .regex(/^\d{7,8}$/, 'CBSE roll number must be 7 or 8 digits')
  .optional()
  .nullable();
