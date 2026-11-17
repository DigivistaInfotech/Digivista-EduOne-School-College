import pg from 'pg';

const target = new URL(process.env.DATABASE_URL ?? '');
if (target.pathname !== '/schoolerp' || !target.hostname.endsWith('.neon.tech') ||
    target.searchParams.get('sslmode') !== 'verify-full') {
  throw new Error('Expected the verified live schoolerp database');
}
const pool = new pg.Pool({ connectionString: target.href, connectionTimeoutMillis: 10_000, keepAlive: true });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('digivista-live-demo-workflows'))");
  const { rows: [demo] } = await client.query(
    `SELECT s.id AS school_id, a.user_id AS admin_id, y.id AS year_id, st.id AS student_id
       FROM schools s JOIN user_role_assignments a ON a.school_id=s.id
       JOIN users u ON u.id=a.user_id AND u.email='admin@erp-live-demo.test'
       JOIN academic_years y ON y.school_id=s.id AND y.status='active'
       JOIN students st ON st.school_id=s.id AND st.admission_number='DEMO-JOURNEY-001'
      WHERE s.code='DIGIVISTA_DEMO' AND s.name='Digivista Demonstration School'`,
  );
  if (!demo) throw new Error('Expected the separate live demonstration institution and demo admission');
  const { school_id: school, admin_id: admin, year_id: year, student_id: student } = demo;
  const prior = await client.query("SELECT 1 FROM exams WHERE school_id=$1 AND name='Demo Grade 6 Term Review'", [school]);
  if (!prior.rowCount) {
    await client.query(
      `WITH scheme AS (
         INSERT INTO grading_schemes(school_id,code,name,is_default)
         VALUES($1,'DEMO-GRADES','Demo grading scale',true) RETURNING id
       ), bands AS (
         INSERT INTO grading_bands(school_id,scheme_id,min_percent,max_percent,grade,remark)
         SELECT $1,id,0,49.99,'D','Needs support' FROM scheme
         UNION ALL SELECT $1,id,50,74.99,'B','Meets expectation' FROM scheme
         UNION ALL SELECT $1,id,75,100,'A','Exceeds expectation' FROM scheme
       ), exam AS (
         INSERT INTO exams(school_id,academic_year_id,name,starts_on,ends_on,grading_scheme_id,status,published_at,published_by,created_by)
         SELECT $1,$2,'Demo Grade 6 Term Review',date '2026-10-05',date '2026-10-09',id,'published',now(),$3,$3 FROM scheme
         RETURNING id
       ), subject AS (
         INSERT INTO exam_subjects(school_id,exam_id,subject_id,max_marks,pass_marks)
         SELECT $1,exam.id,subjects.id,100,35 FROM exam CROSS JOIN subjects
          WHERE subjects.school_id=$1 AND subjects.code IN ('ENG','MAT','SCI') RETURNING id
       )
       INSERT INTO exam_marks(school_id,exam_subject_id,student_id,marks_obtained,entered_by)
       SELECT $1,subject.id,e.student_id,78,$3 FROM subject CROSS JOIN enrollments e
       JOIN classes c ON c.school_id=e.school_id AND c.id=e.class_id
       WHERE e.school_id=$1 AND e.academic_year_id=$2 AND c.code='G6'`,
      [school, year, admin],
    );
    await client.query(
      `INSERT INTO transport_maintenance(school_id,vehicle_id,performed_on,description,cost,vendor_name,created_by)
       SELECT $1,id,current_date-7,'Demo preventive maintenance and brake inspection',2400,'Demo Fleet Workshop',$2
         FROM transport_vehicles WHERE school_id=$1 ORDER BY registration_number LIMIT 1`,
      [school, admin],
    );
    await client.query(
      `INSERT INTO safeguarding_cases(school_id,student_id,reference,category,severity,summary,status,opened_by)
       VALUES($1,$2,'DEMO-WELLBEING-001','wellbeing','low','Synthetic training scenario: classroom adjustment check-in.','monitoring',$3)`,
      [school, student, admin],
    );
    await client.query(
      `WITH category AS (
         INSERT INTO concern_categories(school_id,code,name) VALUES($1,'DEMO-SUPPORT','Demo parent support') RETURNING id
       )
       INSERT INTO concerns(school_id,reference,category_id,subject,description,requester_user_id,requester_name,
                            student_id,assigned_to,status,sla_due_at,resolved_at,resolution_summary)
       SELECT $1,'DEMO-SUPPORT-001',category.id,'Demo fee receipt enquiry',
              'Sample enquiry for a copy of a receipt.',u.id,'Demo Guardian',st.id,$2,'resolved',
              now()+interval '1 day',now(),'Verified the sample ledger and provided the receipt view.'
       FROM category CROSS JOIN users u JOIN guardians g ON g.user_id=u.id AND g.school_id=$1
       JOIN student_guardians link ON link.guardian_id=g.id AND link.school_id=$1
       JOIN students st ON st.id=link.student_id AND st.school_id=$1
       WHERE u.email='parent@erp-live-demo.test' AND st.admission_number='24A015'`,
      [school, admin],
    );
    await client.query(
      `INSERT INTO saved_reports(school_id,name,report_type,filters,shared,created_by)
       VALUES($1,'Demo fee review','fees',jsonb_build_object('academicYearId',$2::text),true,$3)`,
      [school, year, admin],
    );
    await client.query(
      `INSERT INTO in_app_notifications(school_id,user_id,title,body,link,category)
       SELECT $1,id,'Demo receipt available','A synthetic fee receipt is available for this workflow walkthrough.','/fees','fees'
         FROM users WHERE email='finance@erp-live-demo.test'`,
      [school],
    );
  }
  await client.query('COMMIT');
  console.log('Verified demo workflow fixtures for exams, maintenance, safeguarding, support, reports and notifications.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
