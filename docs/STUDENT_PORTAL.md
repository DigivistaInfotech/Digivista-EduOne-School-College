# Student Portal Specification & Architecture

## 1. Overview & Objective

The **Student Portal** (`/student-portal`) is a dedicated self-service workspace designed specifically for enrolled students in Classes 1–12. It provides high-contrast, age-appropriate, mobile-friendly access to all academic, timetable, attendance, homework, and pastoral support features without granting access to administrative controls.

---

## 2. Security & Access Boundary

- **Authentication:** Standard session cookie (`erp_session`) authenticated via `/api/auth/login`.
- **RBAC Guard:** Restricted to users possessing the `student.profile.view` and `learning.view` permissions.
- **Tenant & Entity Isolation:**
  - In `apps/api/src/routes/studentPortal.ts`, the student profile is resolved dynamically via `getLinkedStudent(schoolId, request.user.id)`.
  - The query strictly isolates records where `students.school_id = :schoolId AND students.user_id = :userId` with an active academic year enrollment.
  - Students cannot inspect records of other students or cross school tenant boundaries.

---

## 3. Core Modules & Endpoints

### 3.1 Student Identity & Academic Dashboard (`GET /api/schools/:schoolId/student/me`)
Returns:
- **Personal Details:** Full name (`Kabir Menon`), Roll Number (`1`), Admission Number (`ADM-2026-00919`), CBSE Registration Number (`CBSE/2026/G10/0919`), Date of Birth, Blood Group, Emergency Contact.
- **Class Context:** Class 10, Section A, Class Teacher name, Academic Year (2026-27).
- **Attendance Snapshot:** Total working days marked, attended days, percentage attendance, shortage alert badge if < 80%.
- **Fee Balance Snapshot:** Total charges billed, concessions granted, total verified payments, and outstanding balance.
- **Actionable Counters:** Pending homework assignments count, unread school notices count.

### 3.2 Weekly Timetable Schedule (`GET /api/schools/:schoolId/student/timetable`)
- Lists all active timetable periods (`sequence_no`, `starts_at`, `ends_at`, `is_break`).
- Returns section timetable slots grouped by day of the week (1=Monday to 6=Saturday) with assigned subject code, subject title, teacher display name, and classroom name.

### 3.3 Attendance Ledger (`GET /api/schools/:schoolId/student/attendance`)
- Provides full historical day-by-day attendance roll call records (`present`, `absent`, `late`, `half_day`, `excused`).
- Computes weighted percentage: `(present + late + 0.5 * half_day) / total_marked * 100`.
- Signals `shortageWarning: true` if attendance is strictly below 80.0%, alerting the student of potential board exam eligibility risk.

### 3.4 Homework & Digital Submissions
- **List Assignments (`GET /api/schools/:schoolId/student/homework`):** Returns published homework for the student's assigned section, including title, teacher instructions, due date, maximum marks, and current submission status (`submitted`, `reviewed`, `returned`).
- **Submit Work (`POST /api/schools/:schoolId/student/homework/:assignmentId/submit`):** Accepts student text response and optional document links. Updates or creates `homework_submissions` with timestamp and triggers audit logging.

### 3.5 CBSE Curriculum Learning Assistant (`POST /api/schools/:schoolId/student/learning/assistant`)
- **Deterministic RAG Architecture:** Queries approved school syllabus learning resources (`learning_resources`) for the student's grade level.
- **Modes Supported:**
  - `explain`: Concept explanation with step-by-step principles and curriculum citations.
  - `summarize`: High-level chapter key takeaways and revision points.
  - `quiz` / `practice_questions`: Formulates standard CBSE textbook questions for revision.
- **Bilingual Capability:** Generates responses in English (`en`) or Hindi (`hi`).
- **Academic Boundary Policy:** Refuses non-educational, non-academic queries (e.g. video game walkthroughs, entertainment, gossip) and redirects the student to their approved school curriculum and subject teacher.
- **Auditing & Transparency:** Every query is logged into `learning_assistant_queries` with response text, citations, and disclaimer banner:
  > *"School ERP CBSE Learning Assistant: Generated using approved school syllabus materials for Classes 1–12."*

### 3.6 Pastoral Support & Concerns (`POST /api/schools/:schoolId/student/concerns`)
- Enables students to discreetly raise academic, wellbeing, infrastructure, or personal concerns to school coordinators and designated counselors.
- Generates an auto-tracked ticket reference with SLA target.

### 3.7 Self-Service Profile Correction Request (`POST /api/schools/:schoolId/student/profile-correction`)
- Enables students to submit correction requests for demographic or contact discrepancies (e.g. misspelled name, updated phone, address).
- Requires administrative review before updating core student master tables.
