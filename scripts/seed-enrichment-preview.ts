import type pg from "pg";
import { hashPassword } from "@erp/core";
import { defaultStudentPolicy } from "../packages/shared/src/studentPolicies";

/** Synthetic records for the disposable preview or a newly created demo tenant. */
export async function seedEnrichmentPreview(client: pg.PoolClient, live?: {
  schoolId: string;
  domain: string;
  passwords: Readonly<Record<string, string>>;
}) {
  const schoolId = live?.schoolId ?? (
    await client.query<{ id: string }>(
      `SELECT id FROM schools WHERE code='GREENFIELD'`,
    )
  ).rows[0]!.id;
  const userId = (
    await client.query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1",
      [`admin@${live?.domain ?? "demo.test"}`],
    )
  ).rows[0]!.id;
  for (const [key, value] of [
    [
      "regional_settings",
      { countryCode: "IN", stateCode: "UP", defaultLanguage: "en" },
    ],
    [
      "student_policy_UP",
      {
        ...defaultStudentPolicy("UP"),
        policyReference:
          "Synthetic demo: configure your own approved school policy",
        admissionRequirements: [
          "Review the school-approved admission checklist",
          "Verify guardian contact details",
        ],
      },
    ],
  ] as const)
    await client.query(
      `INSERT INTO school_configurations(school_id,config_key,config_value,version,status,published_by,published_at,notes)
    VALUES($1,$2,$3,1,'published',$4,now(),'Synthetic preview only')`,
      [schoolId, key, JSON.stringify(value), userId],
    );

  const samples = [
    {
      kind: "objective",
      topic: "Solar system",
      question: "Which planet is often called the Red Planet?",
      answer: "Mars",
      options: ["Earth", "Mars", "Venus", "Jupiter"],
    },
    {
      kind: "objective",
      topic: "Environment",
      question: "Which action can help a school save water?",
      answer: "Repair leaking taps",
      options: [
        "Leave taps running",
        "Repair leaking taps",
        "Wash an empty corridor daily",
        "Ignore a leak",
      ],
    },
    {
      kind: "short",
      topic: "Night sky",
      question: "What is a constellation? Give a short explanation.",
      answer:
        "A constellation is a recognised pattern or region of stars seen in the night sky. The apparent pattern does not mean all its stars are physically close together.",
      options: [],
    },
    {
      kind: "long",
      topic: "Water conservation",
      question:
        "Explain why conserving water matters. Describe three practical ways your school can reduce water waste.",
      answer:
        "Water is essential for people and ecosystems, and usable supplies can be limited. A school can repair leaking taps, encourage students to turn taps off, and collect rainwater where a suitable supervised system exists. Explain how each action reduces waste.",
      options: [],
    },
    {
      kind: "very_long",
      topic: "Campaign planning",
      question:
        "Design a one-week school water-conservation campaign. Describe its aim, student roles, activities and how you would check whether it helped.",
      answer:
        "State a measurable aim, such as reducing avoidable water waste. Assign supervised roles for posters, class discussions and reporting leaks. Plan daily activities and compare observations before and after the campaign. Do not ask children to repair plumbing or access unsafe areas.",
      options: [],
    },
  ];
  for (const grade of [6, 7, 8])
    for (const sample of samples)
      await client.query(
        `INSERT INTO enrichment_questions(school_id,grade,subject,chapter,topic,kind,question,answer,options,difficulty,source_title,language,status,created_by,reviewed_by,reviewed_at)
    VALUES($1,$2,'GK','Our world',$3,$4,$5,$6,$7,'medium','Synthetic demo — original teacher-practice sample','en','published',$8,$8,now())`,
        [
          schoolId,
          grade,
          sample.topic,
          sample.kind,
          sample.question,
          sample.answer,
          JSON.stringify(sample.options),
          userId,
        ],
      );

  const clubId = (
    await client.query<{ id: string }>(
      `INSERT INTO school_clubs(school_id,code,name,category,venue,meeting_schedule,max_members)
    VALUES($1,'DEMO-GK-HUB','General Knowledge Club','literary','School library','Fridays, 3–4 pm',40) RETURNING id`,
      [schoolId],
    )
  ).rows[0]!.id;
  const sessionId = (
    await client.query<{ id: string }>(
      `INSERT INTO activity_sessions(school_id,club_id,title,kind,starts_at,ends_at,venue,created_by)
    VALUES($1,$2,'Demo inter-house GK challenge','competition',now()-interval '2 hours',now()-interval '1 hour','School library',$3) RETURNING id`,
      [schoolId, clubId, userId],
    )
  ).rows[0]!.id;
  const learner = (
    await client.query<{ id: string; academic_year_id: string }>(
      `SELECT s.id,e.academic_year_id FROM students s JOIN enrollments e ON e.student_id=s.id AND e.school_id=s.school_id
    JOIN classes c ON c.id=e.class_id AND c.school_id=e.school_id JOIN academic_years y ON y.id=e.academic_year_id AND y.school_id=e.school_id
    WHERE s.school_id=$1 AND c.grade_order=6 AND e.enrollment_status='active' AND y.status='active' ORDER BY s.first_name LIMIT 1`,
      [schoolId],
    )
  ).rows[0];
  if (learner) {
    await client.query(
      `INSERT INTO club_memberships(school_id,club_id,student_id,academic_year_id) VALUES($1,$2,$3,$4)`,
      [schoolId, clubId, learner.id, learner.academic_year_id],
    );
    await client.query(
      `INSERT INTO activity_participation(school_id,session_id,student_id,status,house,score,rank,achievement,recorded_by)
      VALUES($1,$2,$3,'present','Blue',20,1,'Demo participation — synthetic record',$4)`,
      [schoolId, sessionId, learner.id, userId],
    );
  }
  // Additional preview fixtures are synthetic and never run against the configured school DB.
  for (const [email, name, role] of [
    ["principal@demo.test", "Demo Principal", "principal"],
    ["management@demo.test", "Demo Management", "management"],
    ["schooladmin@demo.test", "Demo Institution Administrator", "school_admin"],
  ] as const) {
    const username = email.split("@", 1)[0]!;
    const password = live?.passwords[username];
    if (live && (!password || password.length < 24)) throw new Error(`Missing secure demo credential for ${username}`);
    const account = (
      await client.query<{ id: string }>(
        `INSERT INTO users(email,display_name,password_hash,status)
         SELECT $1,$2,coalesce($4,password_hash),'active' FROM users WHERE id=$3 RETURNING id`,
        [`${username}@${live?.domain ?? "demo.test"}`, name, userId, password ? await hashPassword(password) : null],
      )
    ).rows[0]!;
    await client.query(
      `INSERT INTO user_role_assignments(user_id,school_id,role_id,scope_type,granted_by,reason) SELECT $1,$2,id,'school',$3,'Synthetic preview preset only' FROM roles WHERE code=$4`,
      [account.id, schoolId, userId, role],
    );
  }
  const activeYear = (
    await client.query<{ id: string }>(
      `SELECT id FROM academic_years WHERE school_id=$1 AND status='active'`,
      [schoolId],
    )
  ).rows[0]!;
  const financeId = (
    await client.query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1",
      [`finance@${live?.domain ?? "demo.test"}`],
    )
  ).rows[0]!.id;
  for (const [code, head, name, department, allocated, actual] of [
    [
      "DEMO-INTERNET",
      "internet_broadband",
      "Internet / broadband connection",
      "IT & Communication",
      120000,
      10000,
    ],
    [
      "DEMO-TELEPHONE",
      "telephone_landline",
      "Telephone / landline expenses",
      "Administration",
      24000,
      2000,
    ],
  ] as const) {
    const budget = (
      await client.query<{ id: string }>(
        `INSERT INTO procurement_budgets(school_id,academic_year_id,code,name,expense_head_code,department,allocated_amount,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          schoolId,
          activeYear.id,
          code,
          name,
          head,
          department,
          allocated,
          userId,
        ],
      )
    ).rows[0]!;
    await client.query(
      `INSERT INTO procurement_expenses(school_id,budget_id,description,amount,spent_on,status,created_by,approved_by,approved_at) VALUES($1,$2,$3,$4,current_date,'approved',$5,$6,now())`,
      [
        schoolId,
        budget.id,
        "Synthetic preview: " + name,
        actual,
        userId,
        financeId,
      ],
    );
  }
  const academicCategory = (
    await client.query<{ id: string }>(
      `SELECT id FROM library_categories WHERE school_id=$1 AND code='ACADEMIC_WORKBOOKS'`,
      [schoolId],
    )
  ).rows[0];
  for (const grade of [6, 7, 8]) {
    const cls = (
      await client.query<{ id: string }>(
        `SELECT id FROM classes WHERE school_id=$1 AND grade_order=$2 LIMIT 1`,
        [schoolId, grade],
      )
    ).rows[0];
    if (!cls) continue;
    const book = (
      await client.query<{ id: string }>(
        `INSERT INTO library_books(school_id,category_id,title,author,description,book_type,status) VALUES($1,$2,$3,'DIGI demo teaching team','Synthetic class-filter example, not an official textbook. No physical copies have been added.','academic','active') RETURNING id`,
        [
          schoolId,
          academicCategory?.id ?? null,
          `Demo Class ${grade} — Subject Practice`,
        ],
      )
    ).rows[0]!;
    await client.query(
      "INSERT INTO library_book_classes(school_id,book_id,class_id) VALUES($1,$2,$3)",
      [schoolId, book.id, cls.id],
    );
  }
  await client.query(
    `INSERT INTO library_books(school_id,title,author,description,book_type,status) VALUES($1,'Demo Reading Club — General Knowledge','DIGI demo teaching team','Synthetic shared-reading example. No physical copies have been added.','non_academic','active')`,
    [schoolId],
  );
}
