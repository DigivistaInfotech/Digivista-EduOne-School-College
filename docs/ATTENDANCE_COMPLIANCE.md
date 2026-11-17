# Attendance Compliance & 80% Policy Specification

## 1. Regulatory Context & CBSE Standard

In accordance with CBSE Examination Bylaws (Rule 13 & 14) and established Indian school administrative standards:
- **Mandatory Minimum Attendance:** Students are required to maintain a minimum of **80.0%** (or configured threshold, standard CBSE 75–80%) aggregate attendance during the academic session to be eligible to appear in annual and board examinations.
- **Shortage Register:** Any student whose calculated cumulative attendance falls below 80% is automatically flagged into the school's **Attendance Shortage Register** (`attendance_shortage_cases`).

---

## 2. Calculation Formula & Weighting Engine

Attendance rate is calculated transactionally from `student_attendance`:

$$\text{Attendance Rate} = \frac{\text{Present} + \text{Late} + (0.5 \times \text{Half Day})}{\text{Total Working Days Marked}} \times 100$$

### Status Weights:
- `present`: $1.0$ day attended
- `late`: $1.0$ day attended (with punctuality flag)
- `half_day`: $0.5$ day attended
- `absent`: $0.0$ days
- `excused`: $0.0$ days (unless converted into condoned medical leave)

---

## 3. Shortage Workflow & Lifecycle Stages

Cases in `attendance_shortage_cases` advance through progressive statutory stages:
1. `potential_shortage`: Attendance rate $< 80\%$ based on rolling daily register calculation.
2. `warning_issued`: Formal warning notice dispatched to student and primary guardian.
3. `parent_informed`: Parent acknowledged shortage notification.
4. `explanation_received`: Parent / guardian submitted formal justification (e.g. medical illness, bereavement, approved sports representation) along with supporting leave certificates.
5. `condonation_requested`: Case escalated to Principal and Academic Review Committee.
6. `decision_rendered`: Principal exercises statutory condonation authority or issues debarment order.
7. `resolved`: Case formally closed after student recovers attendance rate above 80% or condonation is ratified.

---

## 4. Warning Ladder Protocol

| Level | Attendance Band | Trigger & Escalation Protocol |
|---|---|---|
| **First Warning** | $78.0\% - 79.9\%$ | Advisory notice generated in student/parent portal; class teacher counselling. |
| **Second Warning** | $75.0\% - 77.9\%$ | Formal written notice to parents; mandatory meeting with Academic Coordinator. |
| **Final Notice / Debarment** | $< 75.0\%$ | Official debarment notice for internal exams; conditional file sent to CBSE Regional Office if condonation grounds apply. |

---

## 5. Medical Condonation Authority (CBSE Rule 14.2)

- Under CBSE Rule 14.2, the Head of Institution (Principal) is empowered to condone attendance shortages up to a maximum cap of **15%** (i.e. minimum effective attendance of 60%) in genuine cases of:
  - Prolonged illness certified by a registered medical practitioner (MBBS).
  - Participation in National / International games or Republic Day Parade recognized by SGFI / CBSE.
- **API Decision Endpoint (`POST /api/schools/:schoolId/attendance/shortages/:id/decision`):**
  - Evaluates:
    - `internalExamEligibility`: `eligible` | `conditional` | `debarred`
    - `boardExamEligibility`: `eligible` | `condonation_submitted` | `condoned_by_board` | `ineligible`
    - `authorizedDecision`: e.g. *"Approved under CBSE Medical Exemption Bylaw 14.1 (within 15% allowance limit)"*.
    - `decisionNotes`: Verification of hospital records and medical officer notes.
  - Generates append-only audit trail in `audit_events`.
