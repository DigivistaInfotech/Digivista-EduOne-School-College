import { writeFile } from "node:fs/promises";
import {
  ROLES,
  PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
} from "../packages/shared/src/permissions";
import { NAV_SECTIONS } from "../apps/web/src/lib/navigation";
const visible = (
  role: (typeof ROLES)[number],
  item: (typeof NAV_SECTIONS)[number]["items"][number],
) =>
  (!item.permission || role.permissions.includes(item.permission)) &&
  (!item.anyPermission ||
    item.anyPermission.some((p) => role.permissions.includes(p)));
let report =
  "# Module and role access mapping\n\nGenerated from the same navigation catalogue as the sidebar and the default seeded role definitions. Live user grants, expiry, revocation, account status and record scope must be checked with the administrator Access checker. A visible page does not imply permission to create, approve, export or access every record.\n\n";
report +=
  "The 17 dashboard personas are presentation previews. Explicit management, principal, institution administrator and collector presets are available. A designation alone grants no permissions. The legacy demo principal retains Main Administrator access. Administrators assign roles in Users & roles; no real account assignments were changed.\n\n";
report +=
  "| Module | " +
  ROLES.map((r) => r.name).join(" | ") +
  " |\n|---|" +
  ROLES.map(() => "---").join("|") +
  "|\n";
for (const group of NAV_SECTIONS)
  for (const item of group.items)
    report +=
      "| " +
      item.label +
      " | " +
      ROLES.map((r) => (visible(r, item) ? "Visible" : "—")).join(" | ") +
      " |\n";
report +=
  "\n## Action-level permission matrix\n\n| Action | Code | " +
  ROLES.map((r) => r.code).join(" | ") +
  " |\n|---|---|" +
  ROLES.map(() => "---").join("|") +
  "|\n";
for (const permission of PERMISSIONS)
  report +=
    "| " +
    PERMISSION_DESCRIPTIONS[permission] +
    " | " +
    permission +
    " | " +
    ROLES.map((r) =>
      r.permissions.includes(permission) ? "Granted" : "—",
    ).join(" | ") +
    " |\n";
report +=
  "\n## Scope and replacement checks\n\n- Teachers: assigned section(s); class grants expand to the class sections. A school-wide grant covers every section only for the permissions granted by that role. Unrelated school-wide HR or transport grants do not expand teaching or student-record scopes. Unsupported campus/department/custom and incompatible role/scope grants are rejected until their boundaries are implemented. Self and linked-child roles do not become unrestricted section scopes.\n- Parents: verified linked children only. Students: own permitted records. Finance, HR, transport, library and auditor capabilities follow their individual action grants above.\n- Access checker: `access.roles.manage` or read-only `access.roles.inspect` required on both UI and API. It reads actual database grants, does not impersonate the selected person, and blocks grants for disabled accounts.\n- Replacement recommendations: active school teacher role plus linked staff account, verified subject/grade profile, no recorded absence/approved leave, no overlapping effective timetable lesson, and weekly workload below the profile limit. Unmarked attendance is explicitly identified for manual availability confirmation.\n- Assignment: selected date must match the lesson weekday and academic year; API repeats eligibility checks under a school assignment lock and audits the result. No permanent user role is granted. Dated substitutes can submit period attendance for their exact assigned lesson through the period endpoint; general daily registers retain the usual section scope.\n- Advanced attendance reads and period writes now enforce section scope. Period writes derive teacher/substitute identity from the scheduled lesson and reject forged identities.\n\n## Remaining review items\n\nThis mapping is not a claim that every workflow has passed user acceptance. Run teacher, parent, student, principal and administration scenarios with school-approved pilot accounts before release. Institution-approved duty separation, dedicated vice-principal/HOD policy, substitute acknowledgement/cancellation screens, absence-triggered automatic suggestions, term/calendar exceptions and a substitute-facing period register are follow-up features. Existing sensitive-data separation and two-person approval controls remain relevant.\n";
await writeFile(
  new URL("../docs/ACCESS_MODULE_MAPPING.md", import.meta.url),
  report,
);
