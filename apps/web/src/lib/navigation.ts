import type { Permission } from "@erp/shared";
import type { IconName } from "../components/ui";
export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  permission?: Permission;
  anyPermission?: Permission[];
  end?: boolean;
}

export const NAV_SECTIONS: Array<{ heading: string; description: string; items: NavItem[] }> = [
  {
    heading: "Home & Setup",
    description: "School overview and starting points",
    items: [
      { to: "/", label: "Overview", icon: "dashboard", end: true },
      {
        to: "/institution-masters",
        label: "Institution masters",
        icon: "layers",
        permission: "school.view",
      },
      { to: "/modules", label: "30 Module Directory", icon: "layers" },
      { to: "/pain-points", label: "20-Year Pain Points", icon: "alert" },
    ],
  },
  {
    heading: "Academic & Learning",
    description: "Classes, teaching, attendance and assessments",
    items: [
      {
        to: "/academic/years",
        label: "Academic years",
        icon: "calendar",
        permission: "academic.structure.view",
      },
      {
        to: "/academic/classes",
        label: "Classes & stages",
        icon: "layers",
        permission: "academic.structure.view",
      },
      {
        to: "/academic/sections",
        label: "Sections",
        icon: "users",
        permission: "academic.structure.view",
      },
      {
        to: "/academic/subjects",
        label: "Subjects & electives",
        icon: "book",
        permission: "academic.structure.view",
      },
      {
        to: "/academic/timetable",
        label: "Timetable & substitutes",
        icon: "calendar",
        permission: "academic.structure.view",
      },
      {
        to: "/attendance",
        label: "Student attendance",
        icon: "check",
        permission: "attendance.register.view",
      },
      {
        to: "/attendance/shortages",
        label: "Shortage & eligibility",
        icon: "alert",
        permission: "attendance.register.view",
      },
      {
        to: "/learning",
        label: "Lesson plans & homework",
        icon: "book",
        anyPermission: [
          "learning.view",
          "learning.manage",
          "learning.submit",
          "learning.grade",
        ],
      },
      {
        to: "/activities",
        label: "Activities Hub",
        icon: "calendar",
        permission: "learning.view",
      },
      {
        to: "/discovery",
        label: "GK & Subject Practice",
        icon: "book",
        permission: "learning.view",
      },
      {
        to: "/paper-builder",
        label: "Question Paper Builder",
        icon: "clipboard",
        permission: "learning.manage",
      },
      {
        to: "/exams",
        label: "Exams & question bank",
        icon: "chart",
        permission: "exams.view",
      },
    ],
  },
  {
    heading: "Students & Operations",
    description: "Admissions and day-to-day campus services",
    items: [
      {
        to: "/students",
        label: "Student & guardian master",
        icon: "users",
        permission: "students.profile.view",
      },
      {
        to: "/students/new",
        label: "Admissions & enrolment",
        icon: "clipboard",
        permission: "students.admission.create",
      },
      {
        to: "/transport",
        label: "Transport & GPS fleet",
        icon: "bus",
        anyPermission: [
          "transport.view",
          "transport.manage",
          "transport.allocate",
        ],
      },
      {
        to: "/library",
        label: "Library & repository",
        icon: "book",
        anyPermission: [
          "library.view",
          "library.manage",
          "library.circulation.manage",
          "library.settings.manage",
        ],
      },
      {
        to: "/procurement",
        label: "Procurement & vendor",
        icon: "layers",
        anyPermission: [
          "procurement.view",
          "procurement.request",
          "procurement.approve",
          "procurement.vendor.manage",
          "procurement.budget.manage",
          "procurement.pay",
        ],
      },
      {
        to: "/concerns",
        label: "Concerns & SLA desk",
        icon: "clipboard",
        anyPermission: [
          "concerns.view",
          "concerns.manage",
          "concerns.assign",
          "concerns.category.manage",
        ],
      },
      {
        to: "/notices",
        label: "Notices & broadcast",
        icon: "paperclip",
        permission: "notices.view",
      },
    ],
  },
  {
    heading: "Finance & Reports",
    description: "Collections, budgets and reporting",
    items: [
      {
        to: "/fee-collection",
        label: "Assigned fee collection",
        icon: "clipboard",
        anyPermission: ["fees.collection.record", "fees.payment.verify"],
      },
      {
        to: "/student-policies",
        label: "Student Policy Centre",
        icon: "shield",
        permission: "school.manage",
      },
      {
        to: "/budget-report",
        label: "Budget vs actual expense",
        icon: "chart",
        permission: "procurement.view",
      },
      {
        to: "/fees",
        label: "Fees & payment ledger",
        icon: "clipboard",
        permission: "fees.view",
      },
      {
        to: "/fees/controls",
        label: "Refunds & controls",
        icon: "clipboard",
        permission: "fees.view",
      },
      {
        to: "/reports",
        label: "Reports & CSV exports",
        icon: "chart",
        permission: "reports.export",
      },
      {
        to: "/data-tools",
        label: "Saved views & batch data",
        icon: "download",
        anyPermission: ["reports.saved.manage", "imports.manage"],
      },
    ],
  },
  {
    heading: "People & HR",
    description: "Staff records, attendance and employment",
    items: [
      {
        to: "/staff",
        label: "Staff directory & payroll",
        icon: "user",
        anyPermission: [
          "hr.employee.view",
          "hr.leave.request",
          "hr.leave.approve",
          "hr.leave.configure",
          "hr.employee.salary.view_sensitive",
        ],
      },
      {
        to: "/staff/attendance",
        label: "Staff attendance & punch",
        icon: "check",
        anyPermission: [
          "hr.attendance.view",
          "hr.attendance.record",
          "hr.attendance.approve",
          "hr.attendance.configure",
        ],
      },
      {
        to: "/hr/recruitment",
        label: "Recruitment & onboarding",
        icon: "clipboard",
        anyPermission: [
          "hr.recruitment.view",
          "hr.recruitment.manage",
          "hr.onboarding.manage",
          "hr.separation.manage",
          "hr.employee.view",
        ],
      },
    ],
  },
  {
    heading: "Portals, Access & Security",
    description: "Family portals, permissions and school controls",
    items: [
      {
        to: "/portal",
        label: "Parent portal",
        icon: "child",
        permission: "guardian.student.view",
      },
      {
        to: "/student-portal",
        label: "Student portal (VI-XII)",
        icon: "user",
        permission: "student.profile.view",
      },
      {
        to: "/safeguarding",
        label: "Safeguarding & wellbeing",
        icon: "shield",
        permission: "safeguarding.case.view",
      },
      {
        to: "/users",
        label: "Identity & access (RBAC)",
        icon: "shield",
        permission: "access.roles.manage",
      },
      {
        to: "/audit",
        label: "Audit trail & security",
        icon: "shield",
        permission: "audit.view",
      },
      {
        to: "/config-studio",
        label: "Configuration Studio",
        icon: "layers",
        permission: "school.view",
      },
    ],
  },
  {
    heading: "Help & Training",
    description: "How-to guides for school staff",
    items: [
      { to: "/help/manual", label: "Staff user manual", icon: "book" },
    ],
  },
];
