import type { ReactNode } from 'react';
import { LinkButton, Icon } from './ui';

export type MasterImportEntity = 'academic_years' | 'classes' | 'sections' | 'subjects' | 'subject_offerings' | 'staff' | 'rooms' | 'timetable_periods' | 'fee_heads' | 'institution_masters';

const files: Record<MasterImportEntity, string> = {
  academic_years: 'academic-years-import.csv',
  classes: 'classes-import.csv',
  sections: 'sections-import.csv',
  subjects: 'subjects-import.csv',
  subject_offerings: 'subject-offerings-import.csv',
  staff: 'staff-import.csv',
  rooms: 'rooms-import.csv',
  timetable_periods: 'timetable-periods-import.csv',
  fee_heads: 'fee-heads-import.csv',
  institution_masters: 'institution-masters-import.csv',
};

export function MasterImportActions({ entityType, className = '' }: { entityType: MasterImportEntity; className?: string }): ReactNode {
  const label = entityType.replaceAll('_', ' ');
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <LinkButton variant="secondary" size="sm" href={`/api/import-templates/${files[entityType]}`} download={files[entityType]}>
        <Icon name="download" className="h-4 w-4" /> Download sample template
      </LinkButton>
      <LinkButton variant="secondary" size="sm" href={`/data-tools?tab=imports&entityType=${encodeURIComponent(entityType)}`}>
        <Icon name="download" className="h-4 w-4" /> Import {label}
      </LinkButton>
    </div>
  );
}
