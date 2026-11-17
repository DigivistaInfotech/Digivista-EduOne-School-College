import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth, useSchoolId } from "../auth/AuthContext";
import {
  getOverview,
  getFeeOverview,
  listOfflinePaymentQueue,
} from "../lib/endpoints";
import { formatMoney } from "../lib/format";
import {
  BudgetOverview,
  BUDGET_REFRESH_OPTIONS,
  fetchBudgetReport,
} from "../components/BudgetOverview";
import {
  Badge,
  BlueprintPanel,
  Button,
  Icon,
  StatCard,
} from "../components/ui";

export type RolePreviewKey =
  | "management"
  | "principal"
  | "vice_principal"
  | "coordinator"
  | "class_teacher"
  | "subject_teacher"
  | "junior_student"
  | "senior_student"
  | "parent"
  | "school_admin"
  | "finance"
  | "hr"
  | "transport"
  | "librarian"
  | "procurement"
  | "exam_officer"
  | "erp_admin";

interface RoleConfig {
  key: RolePreviewKey;
  pageNumber: string;
  name: string;
  title: string;
  subtitle: string;
  filters: string[];
  stats: [
    { label: string; value: string; hint?: string; tone: "mint" },
    { label: string; value: string; hint?: string; tone: "lagoon" },
    { label: string; value: string; hint?: string; tone: "amber" },
    { label: string; value: string; hint?: string; tone: "orchid" },
  ];
  panels: [
    {
      title: string;
      items: Array<{
        label: string;
        statusText?: string;
        dotColor?: "lagoon" | "mint" | "amber" | "orchid";
      }>;
      workspaceUrl: string;
    },
    {
      title: string;
      items: Array<{
        label: string;
        statusText?: string;
        dotColor?: "lagoon" | "mint" | "amber" | "orchid";
      }>;
      workspaceUrl: string;
    },
    {
      title: string;
      items: Array<{
        label: string;
        statusText?: string;
        dotColor?: "lagoon" | "mint" | "amber" | "orchid";
      }>;
      workspaceUrl: string;
    },
  ];
  actions: [
    { label: string; variant: "primary"; url: string },
    { label: string; variant: "secondary"; url: string },
    { label: string; variant: "ghost"; url: string },
  ];
  guardrail: string;
}

export const ROLE_PREVIEWS: Record<RolePreviewKey, RoleConfig> = {
  management: {
    key: "management",
    pageNumber: "18",
    name: "Management / Trustee",
    title: "Institution overview",
    subtitle: "2026-27 | School-approved user",
    filters: ["Campus", "Session", "Period"],
    stats: [
      {
        label: "Enrolment",
        value: "1,240",
        hint: "Nursery to XII",
        tone: "mint",
      },
      {
        label: "Collection",
        value: "demo",
        hint: "Net verified",
        tone: "lagoon",
      },
      {
        label: "Budget",
        value: "demo",
        hint: "Allocated budget",
        tone: "amber",
      },
      {
        label: "Approvals",
        value: "8",
        hint: "Pending review",
        tone: "orchid",
      },
    ],
    panels: [
      {
        title: "Academic trend",
        items: [
          { label: "Enrolment by stage", dotColor: "lagoon" },
          { label: "Retention by cohort", dotColor: "mint" },
          { label: "Year-over-year view", dotColor: "orchid" },
        ],
        workspaceUrl: "/reports",
      },
      {
        title: "Budget vs actual",
        items: [
          { label: "Approved allocations", dotColor: "mint" },
          { label: "Committed purchases", dotColor: "amber" },
          { label: "Review variance", dotColor: "lagoon" },
        ],
        workspaceUrl: "/procurement",
      },
      {
        title: "Admissions outlook",
        items: [
          { label: "Enquiries to admission", dotColor: "lagoon" },
          { label: "Waitlist by class", dotColor: "amber" },
          { label: "Capacity by section", dotColor: "mint" },
        ],
        workspaceUrl: "/students",
      },
    ],
    actions: [
      { label: "Review strategic report", variant: "primary", url: "/reports" },
      { label: "Review budget", variant: "secondary", url: "/procurement" },
      { label: "View approved minutes", variant: "ghost", url: "/notices" },
    ],
    guardrail:
      "Aggregates by default; no automatic individual payroll/health/case access.",
  },

  principal: {
    key: "principal",
    pageNumber: "19",
    name: "Principal",
    title: "School priorities today",
    subtitle: "2026-27 | School-approved user",
    filters: ["Campus", "Stage", "Period"],
    stats: [
      {
        label: "Present",
        value: "demo",
        hint: "Campus attendance",
        tone: "mint",
      },
      {
        label: "Reviews",
        value: "12",
        hint: "Academic follow-up",
        tone: "lagoon",
      },
      {
        label: "Coverage",
        value: "demo",
        hint: "Syllabus velocity",
        tone: "amber",
      },
      {
        label: "Approvals",
        value: "8",
        hint: "Awaiting decision",
        tone: "orchid",
      },
    ],
    panels: [
      {
        title: "Attendance follow-up",
        items: [
          { label: "Shortage: review pending", dotColor: "amber" },
          { label: "Missing registers", dotColor: "lagoon" },
          { label: "Assigned follow-ups", dotColor: "mint" },
        ],
        workspaceUrl: "/attendance/shortages",
      },
      {
        title: "Academic progress",
        items: [
          { label: "Stage-wise results", dotColor: "orchid" },
          { label: "Coverage by subject", dotColor: "lagoon" },
          { label: "Intervention owners", dotColor: "amber" },
        ],
        workspaceUrl: "/exams",
      },
      {
        title: "Staff exceptions",
        items: [
          { label: "Missing-punch requests", dotColor: "amber" },
          { label: "Substitution approvals", dotColor: "mint" },
          { label: "Staff leave review", dotColor: "orchid" },
        ],
        workspaceUrl: "/staff/attendance",
      },
    ],
    actions: [
      {
        label: "Review shortage cases",
        variant: "primary",
        url: "/attendance/shortages",
      },
      {
        label: "Approve published results",
        variant: "secondary",
        url: "/exams",
      },
      { label: "Assign follow-up", variant: "ghost", url: "/concerns" },
    ],
    guardrail:
      "Final decisions need evidence and explicit authority; sensitive cases segregated.",
  },

  vice_principal: {
    key: "vice_principal",
    pageNumber: "20",
    name: "Vice Principal / Academic Head",
    title: "Academic operations",
    subtitle: "2026-27 | School-approved user",
    filters: ["Stage", "Class", "Date"],
    stats: [
      {
        label: "Uncovered periods",
        value: "3",
        hint: "Staff absence",
        tone: "mint",
      },
      { label: "Plans due", value: "6", hint: "Lesson logs", tone: "lagoon" },
      {
        label: "Assessments",
        value: "4",
        hint: "Moderation queue",
        tone: "amber",
      },
      {
        label: "Substitutions",
        value: "2",
        hint: "Pending coordinator",
        tone: "orchid",
      },
    ],
    panels: [
      {
        title: "Timetable exceptions",
        items: [
          { label: "Period 3: teacher absent", dotColor: "amber" },
          { label: "Room conflict flagged", dotColor: "lagoon" },
          { label: "Substitute: pending", dotColor: "mint" },
        ],
        workspaceUrl: "/academic/timetable",
      },
      {
        title: "Stage review",
        items: [
          { label: "VI-VIII coordinator", dotColor: "orchid" },
          { label: "IX-X coordinator", dotColor: "lagoon" },
          { label: "XI-XII coordinator", dotColor: "mint" },
        ],
        workspaceUrl: "/academic/classes",
      },
      {
        title: "Teaching progress",
        items: [
          { label: "Units planned vs taught", dotColor: "mint" },
          { label: "Practical sessions", dotColor: "lagoon" },
          { label: "HOD review queue", dotColor: "amber" },
        ],
        workspaceUrl: "/learning",
      },
    ],
    actions: [
      {
        label: "Assign substitute",
        variant: "primary",
        url: "/academic/timetable",
      },
      { label: "Review plan", variant: "secondary", url: "/learning" },
      { label: "Schedule review", variant: "ghost", url: "/exams" },
    ],
    guardrail:
      "Assigned campus/stages; publication and employee records separately permissioned.",
  },

  coordinator: {
    key: "coordinator",
    pageNumber: "21",
    name: "Coordinator / HOD",
    title: "My academic scope",
    subtitle: "2026-27 | School-approved user",
    filters: ["Class", "Section", "Subject"],
    stats: [
      {
        label: "Missing marks",
        value: "9",
        hint: "By assigned teacher",
        tone: "mint",
      },
      {
        label: "Topics pending",
        value: "5",
        hint: "Unit checklist",
        tone: "lagoon",
      },
      {
        label: "Reviews",
        value: "4",
        hint: "Awaiting feedback",
        tone: "amber",
      },
      {
        label: "Meetings",
        value: "2",
        hint: "Scheduled today",
        tone: "orchid",
      },
    ],
    panels: [
      {
        title: "Class follow-up",
        items: [
          { label: "Section VI A", dotColor: "lagoon" },
          { label: "Attendance exceptions", dotColor: "amber" },
          { label: "Parent requests", dotColor: "mint" },
        ],
        workspaceUrl: "/academic/sections",
      },
      {
        title: "Topic coverage",
        items: [
          { label: "Science: unit progress", dotColor: "mint" },
          { label: "Computer: lab progress", dotColor: "orchid" },
          { label: "Music: planned lessons", dotColor: "amber" },
        ],
        workspaceUrl: "/learning",
      },
      {
        title: "Assessment exceptions",
        items: [
          { label: "Marks not submitted", dotColor: "amber" },
          { label: "Moderation required", dotColor: "orchid" },
          { label: "Review due dates", dotColor: "lagoon" },
        ],
        workspaceUrl: "/exams",
      },
    ],
    actions: [
      { label: "Review syllabus", variant: "primary", url: "/learning" },
      {
        label: "Open class summary",
        variant: "secondary",
        url: "/academic/sections",
      },
      { label: "Assign academic task", variant: "ghost", url: "/concerns" },
    ],
    guardrail:
      "Coordinator sees assigned classes; HOD sees assigned subjects, not all-school data.",
  },

  class_teacher: {
    key: "class_teacher",
    pageNumber: "22",
    name: "Class Teacher",
    title: "My class workspace",
    subtitle: "2026-27 | School-approved user",
    filters: ["Class VI A", "Date", "Session"],
    stats: [
      { label: "Unmarked", value: "2", hint: "Daily register", tone: "mint" },
      {
        label: "Follow-ups",
        value: "4",
        hint: "Parent contact",
        tone: "lagoon",
      },
      {
        label: "Parent requests",
        value: "3",
        hint: "Leaves / notes",
        tone: "amber",
      },
      {
        label: "PTM slots",
        value: "6",
        hint: "Confirmed booking",
        tone: "orchid",
      },
    ],
    panels: [
      {
        title: "Class roster",
        items: [
          { label: "Present / absent / late", dotColor: "mint" },
          { label: "Unmarked pupils", dotColor: "amber" },
          { label: "Correction history", dotColor: "lagoon" },
        ],
        workspaceUrl: "/attendance",
      },
      {
        title: "Parent follow-up",
        items: [
          { label: "Leave: review pending", dotColor: "amber" },
          { label: "PTM: slot requests", dotColor: "orchid" },
          { label: "Contact hours published", dotColor: "mint" },
        ],
        workspaceUrl: "/portal",
      },
      {
        title: "Attendance corrections",
        items: [
          { label: "Requested correction", dotColor: "lagoon" },
          { label: "Evidence and reason", dotColor: "mint" },
          { label: "Independent approval", dotColor: "orchid" },
        ],
        workspaceUrl: "/attendance",
      },
    ],
    actions: [
      {
        label: "Mark class attendance",
        variant: "primary",
        url: "/attendance",
      },
      { label: "Review leave", variant: "secondary", url: "/staff/attendance" },
      { label: "Message guardians", variant: "ghost", url: "/notices" },
    ],
    guardrail:
      "Own section only; class-teacher role may coexist with subject-teacher role.",
  },

  subject_teacher: {
    key: "subject_teacher",
    pageNumber: "23",
    name: "Subject Teacher",
    title: "Today at a glance",
    subtitle: "2026-27 | School-approved user",
    filters: ["Date", "Class", "Subject"],
    stats: [
      {
        label: "Punch",
        value: "not started",
        hint: "Staff kiosk",
        tone: "mint",
      },
      { label: "Periods", value: "6", hint: "Teaching today", tone: "lagoon" },
      {
        label: "Syllabus",
        value: "demo",
        hint: "Unit completion",
        tone: "amber",
      },
      {
        label: "To review",
        value: "14",
        hint: "Homework queue",
        tone: "orchid",
      },
    ],
    panels: [
      {
        title: "Today's timetable",
        items: [
          { label: "09:00 | VI A Science", dotColor: "mint" },
          { label: "10:00 | VII B Science", dotColor: "lagoon" },
          { label: "11:00 | Practical lab", dotColor: "orchid" },
        ],
        workspaceUrl: "/academic/timetable",
      },
      {
        title: "Syllabus completion",
        items: [
          { label: "Unit 2: topic checklist", dotColor: "lagoon" },
          { label: "Mark topic completed", dotColor: "mint" },
          { label: "Attach lesson evidence", dotColor: "amber" },
        ],
        workspaceUrl: "/learning",
      },
      {
        title: "Submissions queue",
        items: [
          { label: "Assignments awaiting review", dotColor: "amber" },
          { label: "Feedback draft", dotColor: "orchid" },
          { label: "Publish approved grade", dotColor: "mint" },
        ],
        workspaceUrl: "/learning",
      },
    ],
    actions: [
      { label: "Punch in / out", variant: "primary", url: "/staff/attendance" },
      {
        label: "Mark period register",
        variant: "secondary",
        url: "/attendance",
      },
      { label: "Update topic progress", variant: "ghost", url: "/learning" },
    ],
    guardrail:
      "Contact card exposes school-approved number, subject and office hours only.",
  },

  junior_student: {
    key: "junior_student",
    pageNumber: "24",
    name: "Junior Student: Nursery-V",
    title: "Hello, Aarav!",
    subtitle: "2026-27 | School-approved user",
    filters: ["My profile", "Academic session"],
    stats: [
      {
        label: "Classes",
        value: "Grade 2-A",
        hint: "Active room",
        tone: "mint",
      },
      {
        label: "Today",
        value: "Present",
        hint: "Morning bell",
        tone: "lagoon",
      },
      {
        label: "Homework",
        value: "1 to do",
        hint: "Drawing story",
        tone: "amber",
      },
      {
        label: "Star badge",
        value: "Helper",
        hint: "Weekly honor",
        tone: "orchid",
      },
    ],
    panels: [
      {
        title: "My activities",
        items: [
          { label: "Story time & phonics", dotColor: "mint" },
          { label: "Math puzzles & shapes", dotColor: "lagoon" },
          { label: "Craft & clay corner", dotColor: "orchid" },
        ],
        workspaceUrl: "/student-portal",
      },
      {
        title: "Today's timetable",
        items: [
          { label: "Period 1: English story", dotColor: "mint" },
          { label: "Period 2: Play & movement", dotColor: "lagoon" },
          { label: "Period 3: Art & colors", dotColor: "amber" },
        ],
        workspaceUrl: "/student-portal",
      },
      {
        title: "Class teacher",
        items: [
          { label: "Tara Sen | Science & Class Teacher", dotColor: "mint" },
          { label: "School extension: DEMO", dotColor: "lagoon" },
          { label: "Contact hours in profile", dotColor: "orchid" },
        ],
        workspaceUrl: "/student-portal",
      },
    ],
    actions: [
      {
        label: "Open learning corner",
        variant: "primary",
        url: "/student-portal",
      },
      { label: "View timetable", variant: "secondary", url: "/student-portal" },
      { label: "School notices", variant: "ghost", url: "/notices" },
    ],
    guardrail:
      "Six primary features; class teacher below. No finance or intimidating risk tiles.",
  },

  senior_student: {
    key: "senior_student",
    pageNumber: "25",
    name: "Senior Student: VI-XII",
    title: "My learning day",
    subtitle: "2026-27 | School-approved user",
    filters: ["Session", "Date", "My subjects"],
    stats: [
      {
        label: "Attendance",
        value: "demo",
        hint: "CBSE 80% track",
        tone: "mint",
      },
      {
        label: "Due tasks",
        value: "2",
        hint: "Physics / Math",
        tone: "lagoon",
      },
      { label: "Subjects", value: "8", hint: "Includes PE/Art", tone: "amber" },
      {
        label: "Next exam",
        value: "demo",
        hint: "Term 2 Schedule",
        tone: "orchid",
      },
    ],
    panels: [
      {
        title: "Today's subjects & practicals",
        items: [
          { label: "Science + practical", dotColor: "mint" },
          { label: "Computer / PE / music", dotColor: "lagoon" },
          { label: "See all 8 demo subjects", dotColor: "orchid" },
        ],
        workspaceUrl: "/student-portal",
      },
      {
        title: "My teachers",
        items: [
          {
            label: "Tara Sen | Science (Class Teacher: VI A)",
            dotColor: "mint",
          },
          { label: "School extension: DEMO", dotColor: "lagoon" },
          { label: "Hours: configured by school", dotColor: "amber" },
        ],
        workspaceUrl: "/student-portal",
      },
      {
        title: "Progress & follow-up",
        items: [
          { label: "Class-teacher feedback", dotColor: "mint" },
          { label: "School warning: review", dotColor: "amber" },
          { label: "View marks and history", dotColor: "orchid" },
        ],
        workspaceUrl: "/student-portal",
      },
    ],
    actions: [
      {
        label: "Submit assignment",
        variant: "primary",
        url: "/student-portal",
      },
      {
        label: "View attendance details",
        variant: "secondary",
        url: "/student-portal",
      },
      {
        label: "Open class-teacher card",
        variant: "ghost",
        url: "/student-portal",
      },
    ],
    guardrail:
      "Example subject count only; includes configured PE/music/computer and components.",
  },

  parent: {
    key: "parent",
    pageNumber: "26",
    name: "Parent / Guardian",
    title: "My children, one place",
    subtitle: "2026-27 | School-approved user",
    filters: ["Child: Aarav", "Session", "Month"],
    stats: [
      {
        label: "Attendance",
        value: "demo",
        hint: "Present this term",
        tone: "mint",
      },
      {
        label: "Fees due",
        value: "demo",
        hint: "Current balance",
        tone: "lagoon",
      },
      {
        label: "Homework",
        value: "2",
        hint: "Pending submission",
        tone: "amber",
      },
      {
        label: "Next event",
        value: "demo",
        hint: "PTM on calendar",
        tone: "orchid",
      },
    ],
    panels: [
      {
        title: "Fees: online / offline",
        items: [
          { label: "Online | Offline report", dotColor: "mint" },
          { label: "School QR configured here", dotColor: "lagoon" },
          { label: "No payable QR in this preview", dotColor: "amber" },
        ],
        workspaceUrl: "/portal",
      },
      {
        title: "Bus route & GPS status",
        items: [
          { label: "Route 4: Maple Enclave stop", dotColor: "lagoon" },
          { label: "Pickup 07:45 · Drop 14:15", dotColor: "mint" },
          { label: "NO LIVE GPS - concept only", dotColor: "amber" },
        ],
        workspaceUrl: "/portal",
      },
      {
        title: "Class teacher & notices",
        items: [
          { label: "Tara Sen | Science (Class: VI A)", dotColor: "mint" },
          { label: "Official school relay extension", dotColor: "lagoon" },
          { label: "Consultation hours published", dotColor: "orchid" },
        ],
        workspaceUrl: "/portal",
      },
    ],
    actions: [
      { label: "Pay / report payment", variant: "primary", url: "/portal" },
      { label: "View bus trip", variant: "secondary", url: "/portal" },
      { label: "Request leave / PTM", variant: "ghost", url: "/portal" },
    ],
    guardrail:
      "Verified children only; masked contact policy; no other passenger locations.",
  },

  school_admin: {
    key: "school_admin",
    pageNumber: "27",
    name: "School Admin / Front Office",
    title: "Daily school operations",
    subtitle: "2026-27 | School-approved user",
    filters: ["Campus", "Class", "Status"],
    stats: [
      {
        label: "Applications",
        value: "18",
        hint: "Admissions pool",
        tone: "mint",
      },
      {
        label: "Documents due",
        value: "9",
        hint: "TC & Bonafide",
        tone: "lagoon",
      },
      {
        label: "Requests",
        value: "7",
        hint: "Parent inquiries",
        tone: "amber",
      },
      {
        label: "Tasks overdue",
        value: "3",
        hint: "Action required",
        tone: "orchid",
      },
    ],
    panels: [
      {
        title: "Admissions queue",
        items: [
          { label: "Missing document", dotColor: "amber" },
          { label: "Duplicate application", dotColor: "lagoon" },
          { label: "Offer awaiting acceptance", dotColor: "mint" },
        ],
        workspaceUrl: "/students",
      },
      {
        title: "Records & certificates",
        items: [
          { label: "TC: approval pending", dotColor: "amber" },
          { label: "Bonafide: ready", dotColor: "mint" },
          { label: "Profile correction", dotColor: "lagoon" },
        ],
        workspaceUrl: "/reports",
      },
      {
        title: "Parent service desk",
        items: [
          { label: "Verify guardian request", dotColor: "mint" },
          { label: "Route complaint", dotColor: "amber" },
          { label: "Escalate overdue task", dotColor: "orchid" },
        ],
        workspaceUrl: "/concerns",
      },
    ],
    actions: [
      { label: "Review application", variant: "primary", url: "/students" },
      { label: "Issue certificate", variant: "secondary", url: "/reports" },
      { label: "Verify guardian request", variant: "ghost", url: "/students" },
    ],
    guardrail:
      "Different from technical ERP admin; financial verification not implicit.",
  },

  finance: {
    key: "finance",
    pageNumber: "28",
    name: "Finance / Accounts",
    title: "Collections and exceptions",
    subtitle: "2026-27 | School-approved user",
    filters: ["Date", "Class", "Fee head", "Mode"],
    stats: [
      {
        label: "Verified",
        value: "demo",
        hint: "Posted collections",
        tone: "mint",
      },
      {
        label: "Pending",
        value: "11",
        hint: "Awaiting bank match",
        tone: "lagoon",
      },
      {
        label: "Unmatched",
        value: "3",
        hint: "Scroll exceptions",
        tone: "amber",
      },
      {
        label: "Refund review",
        value: "2",
        hint: "Dual authorization",
        tone: "orchid",
      },
    ],
    panels: [
      {
        title: "Payment verification queue",
        items: [
          { label: "Cash: counter posting", dotColor: "mint" },
          { label: "UPI report: bank check", dotColor: "amber" },
          { label: "Cheque: not cleared", dotColor: "lagoon" },
        ],
        workspaceUrl: "/fees",
      },
      {
        title: "Bank reconciliation",
        items: [
          { label: "Import statement preview", dotColor: "lagoon" },
          { label: "Match invoice reference", dotColor: "mint" },
          { label: "Unallocated funds queue", dotColor: "amber" },
        ],
        workspaceUrl: "/fees/controls",
      },
      {
        title: "Transport fee ledger",
        items: [
          { label: "Route/date effective fee", dotColor: "lagoon" },
          { label: "Concession approval", dotColor: "orchid" },
          { label: "Receipt allocation", dotColor: "mint" },
        ],
        workspaceUrl: "/fees",
      },
    ],
    actions: [
      { label: "Verify bank match", variant: "primary", url: "/fees" },
      { label: "Issue authorised receipt", variant: "secondary", url: "/fees" },
      { label: "Review refund", variant: "ghost", url: "/fees/controls" },
    ],
    guardrail:
      "Totals derived from posted records; unverified reports never count as collected.",
  },

  hr: {
    key: "hr",
    pageNumber: "29",
    name: "HR / Staff Self-service",
    title: "People and workforce",
    subtitle: "2026-27 | School-approved user",
    filters: ["Department", "Date", "Status"],
    stats: [
      {
        label: "Staff present",
        value: "demo",
        hint: "Biometric / kiosk",
        tone: "mint",
      },
      {
        label: "Punch gaps",
        value: "5",
        hint: "Missed tap out",
        tone: "lagoon",
      },
      {
        label: "Leave pending",
        value: "4",
        hint: "Approval queue",
        tone: "amber",
      },
      {
        label: "Onboarding",
        value: "2",
        hint: "Joining checklist",
        tone: "orchid",
      },
    ],
    panels: [
      {
        title: "Attendance exceptions",
        items: [
          { label: "Missing punch-out", dotColor: "amber" },
          { label: "Correction pending", dotColor: "lagoon" },
          { label: "Leave overlap flagged", dotColor: "mint" },
        ],
        workspaceUrl: "/staff/attendance",
      },
      {
        title: "Hiring & onboarding",
        items: [
          { label: "Interview evaluation", dotColor: "lagoon" },
          { label: "Hiring approval", dotColor: "mint" },
          { label: "Joining checklist", dotColor: "orchid" },
        ],
        workspaceUrl: "/hr/recruitment",
      },
      {
        title: "Payroll approvals",
        items: [
          { label: "Attendance inputs locked", dotColor: "mint" },
          { label: "Payroll review queue", dotColor: "amber" },
          { label: "Payslip release permission", dotColor: "orchid" },
        ],
        workspaceUrl: "/staff",
      },
    ],
    actions: [
      {
        label: "Review correction",
        variant: "primary",
        url: "/staff/attendance",
      },
      { label: "Process leave", variant: "secondary", url: "/staff" },
      { label: "Open own self-service", variant: "ghost", url: "/staff" },
    ],
    guardrail:
      "HR gets authorised employment data; ordinary staff sees own punches, leave and payslips.",
  },

  transport: {
    key: "transport",
    pageNumber: "30",
    name: "Transport Officer / Driver",
    title: "Safe trips and allocations",
    subtitle: "2026-27 | School-approved user",
    filters: ["Route", "Trip", "Date", "Vehicle"],
    stats: [
      {
        label: "Trips active",
        value: "6",
        hint: "Fleet in transit",
        tone: "mint",
      },
      {
        label: "Seats free",
        value: "demo",
        hint: "Capacity utilization",
        tone: "lagoon",
      },
      {
        label: "Stale trackers",
        value: "1",
        hint: "Telemetry check",
        tone: "amber",
      },
      {
        label: "Maintenance",
        value: "2",
        hint: "Service scheduled",
        tone: "orchid",
      },
    ],
    panels: [
      {
        title: "Trip control / GPS",
        items: [
          { label: "Active GPS telemetry stream", dotColor: "mint" },
          { label: "Stale device alert: Bus 03", dotColor: "amber" },
          { label: "NO LIVE GPS - concept only", dotColor: "lagoon" },
        ],
        workspaceUrl: "/transport",
      },
      {
        title: "Stops and allocation",
        items: [
          { label: "Capacity by vehicle", dotColor: "mint" },
          { label: "Effective-dated stop", dotColor: "lagoon" },
          { label: "Assigned children only", dotColor: "orchid" },
        ],
        workspaceUrl: "/transport",
      },
      {
        title: "Transport fee exceptions",
        items: [
          { label: "Route change fee review", dotColor: "amber" },
          { label: "Pending deposit check", dotColor: "mint" },
          { label: "Linked invoice history", dotColor: "lagoon" },
        ],
        workspaceUrl: "/transport",
      },
    ],
    actions: [
      { label: "Start assigned trip", variant: "primary", url: "/transport" },
      { label: "Review capacity", variant: "secondary", url: "/transport" },
      { label: "Report incident", variant: "ghost", url: "/concerns" },
    ],
    guardrail:
      "Driver mobile mode: assigned trip, stop/boarding list; no fees or whole-school roster.",
  },

  librarian: {
    key: "librarian",
    pageNumber: "31",
    name: "Librarian",
    title: "Circulation desk",
    subtitle: "2026-27 | School-approved user",
    filters: ["Title", "Member", "State"],
    stats: [
      {
        label: "Issues today",
        value: "24",
        hint: "Circulation volume",
        tone: "mint",
      },
      {
        label: "Returns due",
        value: "16",
        hint: "Current shelf window",
        tone: "lagoon",
      },
      {
        label: "Reservations",
        value: "7",
        hint: "Borrower queue",
        tone: "amber",
      },
      {
        label: "Lost review",
        value: "1",
        hint: "Admin waiver",
        tone: "orchid",
      },
    ],
    panels: [
      {
        title: "Scan / search catalogue",
        items: [
          { label: "Accession / barcode", dotColor: "mint" },
          { label: "Available copies", dotColor: "lagoon" },
          { label: "Borrower eligibility", dotColor: "orchid" },
        ],
        workspaceUrl: "/library",
      },
      {
        title: "Issue & return queue",
        items: [
          { label: "Issue: confirm copy", dotColor: "mint" },
          { label: "Return: record condition", dotColor: "lagoon" },
          { label: "Renew: policy check", dotColor: "amber" },
        ],
        workspaceUrl: "/library",
      },
      {
        title: "Overdue follow-up",
        items: [
          { label: "Overdue list by class", dotColor: "amber" },
          { label: "Fine rule: configured", dotColor: "mint" },
          { label: "Lost item: approval", dotColor: "orchid" },
        ],
        workspaceUrl: "/library",
      },
    ],
    actions: [
      { label: "Scan accession", variant: "primary", url: "/library" },
      { label: "Issue / return", variant: "secondary", url: "/library" },
      { label: "Review lost item", variant: "ghost", url: "/library" },
    ],
    guardrail: "Borrower eligibility and copy availability checked atomically.",
  },

  procurement: {
    key: "procurement",
    pageNumber: "32",
    name: "Procurement / Vendor",
    title: "Purchases and settlement",
    subtitle: "2026-27 | School-approved user",
    filters: ["Vendor", "Stage", "Budget"],
    stats: [
      {
        label: "Requests",
        value: "9",
        hint: "Department indents",
        tone: "mint",
      },
      {
        label: "POs open",
        value: "6",
        hint: "Active purchase orders",
        tone: "lagoon",
      },
      {
        label: "Discrepancies",
        value: "2",
        hint: "Goods receipt mismatch",
        tone: "amber",
      },
      {
        label: "Bills due",
        value: "4",
        hint: "Payment schedule",
        tone: "orchid",
      },
    ],
    panels: [
      {
        title: "Approval queue",
        items: [
          { label: "Request with item lines", dotColor: "mint" },
          { label: "Stage approver", dotColor: "lagoon" },
          { label: "Budget availability", dotColor: "amber" },
        ],
        workspaceUrl: "/procurement",
      },
      {
        title: "Receipts & bills",
        items: [
          { label: "Quantity discrepancy", dotColor: "amber" },
          { label: "Bill against PO", dotColor: "mint" },
          { label: "Duplicate invoice check", dotColor: "lagoon" },
        ],
        workspaceUrl: "/procurement",
      },
      {
        title: "Budget commitments",
        items: [
          { label: "Allocation vs commitment", dotColor: "mint" },
          { label: "Expense by department", dotColor: "orchid" },
          { label: "Vendor settlement queue", dotColor: "lagoon" },
        ],
        workspaceUrl: "/procurement",
      },
    ],
    actions: [
      { label: "Review request", variant: "primary", url: "/procurement" },
      { label: "Record receipt", variant: "secondary", url: "/procurement" },
      { label: "Match vendor bill", variant: "ghost", url: "/procurement" },
    ],
    guardrail:
      "Vendor view restricted to own POs, deliveries, invoices and settlement statuses.",
  },

  exam_officer: {
    key: "exam_officer",
    pageNumber: "33",
    name: "Examination Officer",
    title: "Assessment readiness",
    subtitle: "2026-27 | School-approved user",
    filters: ["Session", "Exam", "Class"],
    stats: [
      {
        label: "Marks missing",
        value: "12",
        hint: "Pending teacher entry",
        tone: "mint",
      },
      {
        label: "Reviews",
        value: "4",
        hint: "Moderation tickets",
        tone: "lagoon",
      },
      { label: "Papers", value: "6", hint: "Bank verified", tone: "amber" },
      {
        label: "Results ready",
        value: "3",
        hint: "Publication lock",
        tone: "orchid",
      },
    ],
    panels: [
      {
        title: "Exam timetable",
        items: [
          { label: "Class / subject / venue", dotColor: "mint" },
          { label: "Paper access controlled", dotColor: "amber" },
          { label: "Practical schedule", dotColor: "orchid" },
        ],
        workspaceUrl: "/exams",
      },
      {
        title: "Marks moderation",
        items: [
          { label: "Missing marks by teacher", dotColor: "amber" },
          { label: "Moderation pending", dotColor: "lagoon" },
          { label: "Publication approval", dotColor: "mint" },
        ],
        workspaceUrl: "/exams",
      },
      {
        title: "Eligibility review",
        items: [
          { label: "Calculation details", dotColor: "mint" },
          { label: "Exception evidence", dotColor: "amber" },
          { label: "Authorised review decision", dotColor: "orchid" },
        ],
        workspaceUrl: "/attendance/shortages",
      },
    ],
    actions: [
      { label: "Review marks", variant: "primary", url: "/exams" },
      {
        label: "Route exception",
        variant: "secondary",
        url: "/attendance/shortages",
      },
      { label: "Publish approved result", variant: "ghost", url: "/exams" },
    ],
    guardrail:
      "No final Board decision from an unreviewed automated shortage flag.",
  },

  erp_admin: {
    key: "erp_admin",
    pageNumber: "34",
    name: "ERP Admin / DigiVista Support",
    title: "Access and system health",
    subtitle: "2026-27 | School-approved user",
    filters: ["School", "Scope", "Job status"],
    stats: [
      {
        label: "Active users",
        value: "demo",
        hint: "Provisioned accounts",
        tone: "mint",
      },
      {
        label: "Failed jobs",
        value: "2",
        hint: "Retry diagnostics",
        tone: "lagoon",
      },
      {
        label: "Backup",
        value: "demo",
        hint: "Integrity verified",
        tone: "amber",
      },
      {
        label: "Access reviews",
        value: "4",
        hint: "Privileged audit",
        tone: "orchid",
      },
    ],
    panels: [
      {
        title: "Identity & permissions",
        items: [
          { label: "Role and scope review", dotColor: "mint" },
          { label: "MFA for privileged users", dotColor: "amber" },
          { label: "Employee exit revocation", dotColor: "lagoon" },
        ],
        workspaceUrl: "/users",
      },
      {
        title: "Integration diagnostics",
        items: [
          { label: "Only configured providers", dotColor: "lagoon" },
          { label: "Failed delivery retries", dotColor: "amber" },
          { label: "Redacted diagnostics", dotColor: "mint" },
        ],
        workspaceUrl: "/audit",
      },
      {
        title: "Backup & audit",
        items: [
          { label: "Backup integrity", dotColor: "mint" },
          { label: "Restore rehearsal evidence", dotColor: "orchid" },
          { label: "Privileged activity history", dotColor: "lagoon" },
        ],
        workspaceUrl: "/audit",
      },
    ],
    actions: [
      { label: "Review access", variant: "primary", url: "/users" },
      { label: "Retry authorised job", variant: "secondary", url: "/audit" },
      { label: "Open configuration", variant: "ghost", url: "/config-studio" },
    ],
    guardrail:
      "Platform support requires approved school scope and expiry; credentials never shown.",
  },
};

export function DashboardPage(): ReactNode {
  const { can, membership } = useAuth();
  const schoolId = useSchoolId();
  const navigate = useNavigate();
  const roles = membership?.roles ?? [];

  // Determine initial role
  const defaultRole: RolePreviewKey = (() => {
    if (roles.includes("main_admin") || roles.includes("admin"))
      return "management";
    if (roles.includes("principal")) return "principal";
    if (roles.includes("academic_coordinator")) return "coordinator";
    if (roles.includes("finance")) return "finance";
    if (roles.includes("hr")) return "hr";
    if (roles.includes("transport")) return "transport";
    if (roles.includes("librarian")) return "librarian";
    if (roles.includes("teacher")) return "class_teacher";
    if (roles.includes("parent")) return "parent";
    if (roles.includes("student")) return "senior_student";
    return "management";
  })();

  const [activePersona, setActivePersona] =
    useState<RolePreviewKey>(defaultRole);
  const currentRole = ROLE_PREVIEWS[activePersona];
  const budgetQuery = useQuery({
    ...BUDGET_REFRESH_OPTIONS,
    queryKey: ["budget-report", schoolId, "active"],
    queryFn: () => fetchBudgetReport(schoolId),
    enabled: can("procurement.view"),
  });

  // Queries for live data enrichment
  const overviewQuery = useQuery({
    queryKey: ["overview", schoolId],
    queryFn: () => getOverview(schoolId),
    enabled: can("school.view"),
  });

  const feeOverviewQuery = useQuery({
    queryKey: ["fee-overview", schoolId],
    queryFn: () => getFeeOverview(schoolId),
    enabled: can("fees.view"),
  });

  const offlineQueueQuery = useQuery({
    queryKey: ["offline-payments-queue", schoolId],
    queryFn: () => listOfflinePaymentQueue(schoolId),
    enabled: can("fees.payment.verify") || can("fees.view"),
  });

  // Blueprint personas do not manufacture operational counts. Unknown metrics stay blank.
  const resolveStatValue = (label: string, _fallback: string): string => {
    if (label === "Budget")
      return can("procurement.view") && budgetQuery.data
        ? formatMoney(budgetQuery.data.totals.allocated)
        : "—";
    if (label === "Enrolment")
      return overviewQuery.data
        ? String(overviewQuery.data.studentsActive)
        : "—";
    if (label === "Collection" || label === "Verified")
      return feeOverviewQuery.data
        ? formatMoney(feeOverviewQuery.data.totalCollected)
        : "—";
    if (label === "Pending")
      return offlineQueueQuery.data
        ? String(
            offlineQueueQuery.data.filter(
              (item: { status: string }) => item.status === "pending",
            ).length,
          )
        : "—";
    return "—";
  };

  if (roles.includes("student") && !can("students.profile.view"))
    return <Navigate to="/student-portal" replace />;
  if (roles.includes("parent") && !can("students.profile.view"))
    return <Navigate to="/portal" replace />;

  return (
    <div className="space-y-6">
      {/* 17 Role Preview Switcher Bar */}
      <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-[#087F83] text-white text-xs font-extrabold">
              17
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#182944]">
                Role UI Previews (Pages 18–34)
              </p>
              <p className="text-[11px] text-slate-500">
                Layout preview only · Your actual permissions remain unchanged.
                Unconnected metrics show —
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="preview-role-select"
              className="text-xs font-bold text-slate-600 uppercase tracking-wide"
            >
              Preview Role:
            </label>
            <select
              id="preview-role-select"
              value={activePersona}
              onChange={(e) =>
                setActivePersona(e.target.value as RolePreviewKey)
              }
              className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-bold text-[#182944] focus:border-[#087F83] focus:outline-none min-h-[38px]"
            >
              <optgroup label="Governance & Leadership">
                <option value="management">
                  Page 18: Management / Trustee
                </option>
                <option value="principal">Page 19: Principal</option>
                <option value="vice_principal">
                  Page 20: Vice Principal / Academic Head
                </option>
              </optgroup>
              <optgroup label="Academic Chain">
                <option value="coordinator">Page 21: Coordinator / HOD</option>
                <option value="class_teacher">Page 22: Class Teacher</option>
                <option value="subject_teacher">
                  Page 23: Subject Teacher
                </option>
              </optgroup>
              <optgroup label="Students & Parents">
                <option value="junior_student">
                  Page 24: Junior Student: Nursery-V
                </option>
                <option value="senior_student">
                  Page 25: Senior Student: VI-XII
                </option>
                <option value="parent">Page 26: Parent / Guardian</option>
              </optgroup>
              <optgroup label="Operations & Administration">
                <option value="school_admin">
                  Page 27: School Admin / Front Office
                </option>
                <option value="finance">Page 28: Finance / Accounts</option>
                <option value="hr">Page 29: HR / Staff Self-service</option>
                <option value="transport">
                  Page 30: Transport Officer / Driver
                </option>
                <option value="librarian">Page 31: Librarian</option>
                <option value="procurement">
                  Page 32: Procurement / Vendor
                </option>
                <option value="exam_officer">
                  Page 33: Examination Officer
                </option>
                <option value="erp_admin">
                  Page 34: ERP Admin / DigiVista Support
                </option>
              </optgroup>
            </select>

            <Link to="/modules">
              <Button
                variant="secondary"
                size="sm"
                className="!text-xs !py-1.5 !min-h-[38px]"
              >
                <Icon name="layers" className="h-3.5 w-3.5" />
                30 Module Cards
              </Button>
            </Link>

            <Link to="/pain-points">
              <Button
                variant="ghost"
                size="sm"
                className="!text-xs !py-1.5 !min-h-[38px]"
              >
                <Icon name="alert" className="h-3.5 w-3.5 text-amber-600" />9
                Pain Points
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Blueprint Role Header (exact blueprint specs) */}
      <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-5">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="rounded-full bg-[#182944] text-white px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider">
                Page {currentRole.pageNumber} Specification
              </span>
              <span className="text-xs font-bold text-[#087F83] uppercase tracking-wider">
                {currentRole.name}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#182944]">
              {currentRole.title}
            </h1>
            <p className="mt-1 text-xs font-medium text-slate-500">
              {currentRole.subtitle}
            </p>
          </div>

          {/* Blueprint Breadcrumb Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {currentRole.filters.map((filterName, idx) => (
              <span
                key={idx}
                className="rounded-xl bg-[#F3F6FA] border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 shadow-xs flex items-center gap-1.5"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[#087F83]" />
                {filterName}
              </span>
            ))}
          </div>
        </div>

        {/* 4 Stat Cards Row */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {currentRole.stats.map((stat, idx) => {
            const card = (
              <StatCard
                label={stat.label}
                value={resolveStatValue(stat.label, stat.value)}
                hint={stat.hint}
                tone={stat.tone}
                color={idx}
              />
            );
            return stat.label.includes("Budget") && can("procurement.view") ? (
              <Link key={idx} to="/budget-report">
                {card}
              </Link>
            ) : (
              <div key={idx}>{card}</div>
            );
          })}
        </div>

        {can("procurement.view") && (
          <div className="mt-6">
            <BudgetOverview />
          </div>
        )}

        {/* 3 Operational Panels Row */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-5">
          {currentRole.panels.map((panel, idx) => (
            <BlueprintPanel
              key={idx}
              title={panel.title}
              items={panel.items}
              workspaceUrl={panel.workspaceUrl}
              workspaceLabel="Open workspace >"
            />
          ))}
        </div>

        {/* Action Toolbar (3 action buttons from blueprint) */}
        <div className="mt-6 pt-5 border-t border-slate-100 flex flex-wrap items-center gap-3">
          {currentRole.actions.map((act, idx) => {
            if (act.variant === "primary") {
              return (
                <Button
                  key={idx}
                  variant="primary"
                  onClick={() => navigate(act.url)}
                  className="rounded-2xl px-6 min-h-[44px]"
                >
                  {act.label}
                </Button>
              );
            }
            if (act.variant === "secondary") {
              return (
                <Button
                  key={idx}
                  variant="secondary"
                  onClick={() => navigate(act.url)}
                  className="rounded-2xl px-6 min-h-[44px]"
                >
                  {act.label}
                </Button>
              );
            }
            return (
              <button
                key={idx}
                type="button"
                onClick={() => navigate(act.url)}
                className="text-xs font-bold text-[#087F83] hover:underline px-3 py-2 min-h-[44px] flex items-center"
              >
                {act.label}
              </button>
            );
          })}
        </div>

        {/* Blueprint Guardrail Policy Note at bottom */}
        <div className="mt-5 rounded-xl bg-slate-50 border border-slate-200/80 p-3.5 flex items-start gap-2.5 text-xs text-slate-600">
          <Icon
            name="shield"
            className="h-4 w-4 shrink-0 mt-0.5 text-[#087F83]"
          />
          <div>
            <span className="font-extrabold uppercase text-[10px] tracking-wider text-slate-500 block">
              Governance & Permission Boundary
            </span>
            <p className="mt-0.5 font-medium leading-relaxed">
              {currentRole.guardrail}
            </p>
          </div>
        </div>
      </div>

      {/* Special Junior Student Preview (Page 24 specific layout when junior student selected) */}
      {activePersona === "junior_student" && (
        <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
            <span className="text-xs font-bold uppercase tracking-wider text-[#087F83]">
              Page 24 · Junior Student Dedicated 6-Feature Grid
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-[#DDF4EC]/40 p-5 hover:bg-[#DDF4EC]/60 transition">
              <span className="text-xs font-extrabold text-[#087F83]">01</span>
              <h3 className="text-base font-bold text-[#182944] mt-1">
                My profile
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                My class and school
              </p>
              <Link
                to="/student-portal"
                className="text-xs font-bold text-[#087F83] mt-3 inline-block hover:underline"
              >
                Open &gt;
              </Link>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-[#E6F4F5]/50 p-5 hover:bg-[#E6F4F5]/80 transition">
              <span className="text-xs font-extrabold text-[#087F83]">02</span>
              <h3 className="text-base font-bold text-[#182944] mt-1">
                Attendance
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                View today and this month
              </p>
              <Link
                to="/student-portal"
                className="text-xs font-bold text-[#087F83] mt-3 inline-block hover:underline"
              >
                Open &gt;
              </Link>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-[#FEF6E9]/60 p-5 hover:bg-[#FEF6E9]/90 transition">
              <span className="text-xs font-extrabold text-[#B47408]">03</span>
              <h3 className="text-base font-bold text-[#182944] mt-1">
                Homework
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Activities to complete
              </p>
              <Link
                to="/student-portal"
                className="text-xs font-bold text-[#087F83] mt-3 inline-block hover:underline"
              >
                Open &gt;
              </Link>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-[#F3EFFC]/50 p-5 hover:bg-[#F3EFFC]/80 transition">
              <span className="text-xs font-extrabold text-[#7654C7]">04</span>
              <h3 className="text-base font-bold text-[#182944] mt-1">
                My timetable
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Today's classes</p>
              <Link
                to="/student-portal"
                className="text-xs font-bold text-[#087F83] mt-3 inline-block hover:underline"
              >
                Open &gt;
              </Link>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-[#FEF6E9]/50 p-5 hover:bg-[#FEF6E9]/80 transition">
              <span className="text-xs font-extrabold text-[#B47408]">05</span>
              <h3 className="text-base font-bold text-[#182944] mt-1">
                Learning corner
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Worksheets and stories
              </p>
              <Link
                to="/student-portal"
                className="text-xs font-bold text-[#087F83] mt-3 inline-block hover:underline"
              >
                Open &gt;
              </Link>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 hover:bg-slate-100 transition">
              <span className="text-xs font-extrabold text-[#087F83]">06</span>
              <h3 className="text-base font-bold text-[#182944] mt-1">
                Notices & calendar
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                School news and events
              </p>
              <Link
                to="/notices"
                className="text-xs font-bold text-[#087F83] mt-3 inline-block hover:underline"
              >
                Open &gt;
              </Link>
            </div>
          </div>

          <div className="mt-5 rounded-2xl bg-[#DDF4EC]/60 border border-[#087F83]/20 p-4 flex items-center justify-between text-xs text-[#087F83]">
            <span className="font-bold">
              Class teacher: Tara Sen | School extension: DEMO | Contact hours
              in profile
            </span>
            <Badge tone="mint">Verified Linked</Badge>
          </div>
        </div>
      )}
    </div>
  );
}
