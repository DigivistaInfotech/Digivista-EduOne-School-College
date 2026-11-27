import type { Permission, ScopeType } from "@erp/shared";

export interface ScopeAssignment {
  scopeType: ScopeType;
  scopeId: string | null;
  permissions?: string[];
}

export interface ActorAccess {
  userId: string;
  schoolId: string;
  permissions: ReadonlySet<string>;
  assignments: ScopeAssignment[];
}

/**
 * True when the actor holds the permission. Unknown codes are denied.
 * This is a pure function so it is directly unit-testable without a database.
 */
export function hasPermission(
  actor: ActorAccess,
  permission: Permission,
): boolean {
  return actor.permissions.has(permission);
}

/**
 * Returns true when an assignment grants access to a section-scoped record.
 * School-wide assignments cover every section; section assignments cover the
 * exact section only. Class-level assignments are expanded to their sections by loadActor.
 */
export function canAccessSection(
  actor: ActorAccess,
  sectionId: string,
  permission?: Permission,
): boolean {
  if(permission&&!actor.permissions.has(permission))return false;
  for (const assignment of actor.assignments.filter(a=>!permission||!a.permissions||a.permissions.includes(permission))) {
    if (
      assignment.scopeType === "school"
    ) {
      return true;
    }
    if (
      assignment.scopeType === "section" &&
      assignment.scopeId === sectionId
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The set of section IDs the actor may see, or null when unrestricted.
 * API queries use this to constrain row visibility instead of trusting
 * client-supplied section filters.
 */
export function visibleSectionIds(actor: ActorAccess, permission?:Permission): string[] | null {
  if(permission&&!actor.permissions.has(permission))return [];
  const assignments=actor.assignments.filter(a=>!permission||!a.permissions||a.permissions.includes(permission));
  if (
    assignments.some(
      (a) =>
        a.scopeType === "school",
    )
  )
    return null;
  const restricted = assignments.filter(
    (assignment) =>
      assignment.scopeType === "section" && assignment.scopeId !== null,
  );
  if (restricted.length === 0) return [];
  return [
    ...new Set(restricted.map((assignment) => assignment.scopeId as string)),
  ];
}

export function isSchoolScoped(actor: ActorAccess): boolean {
  return actor.assignments.some(
    (assignment) => assignment.scopeType === "school",
  );
}

/** Normalizes a full name for display, trimming accidental double spaces. */
export function fullName(...parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
}
