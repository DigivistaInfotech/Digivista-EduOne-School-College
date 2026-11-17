import { useQuery } from '@tanstack/react-query';
import { useMemo, type ReactNode } from 'react';
import { useSchoolId } from '../auth/AuthContext';
import { listClasses, listSections, type SectionRecord } from '../lib/endpoints';
import { Select } from './ui';

export interface ClassSectionOption {
  sectionId: string;
  classId: string;
  className: string;
  sectionName: string;
  label: string; // e.g. "Nursery", "Class 1-A", "Class 11-Science"
  enrolled: number;
  capacity: number;
  gradeOrder: number;
}

export function formatClassSectionLabel(className: string, sectionName: string): string {
  const cleanClass = className.trim();
  const cleanSection = sectionName.trim().replace(/^Section\s+/i, '');

  // Nursery, LKG, UKG special formatting
  if (/^(Nursery|LKG|UKG)$/i.test(cleanClass)) {
    if (cleanSection.toUpperCase() === 'MAIN' || cleanSection.toUpperCase() === 'A') {
      return cleanClass;
    }
    return `${cleanClass}-${cleanSection}`;
  }

  // Class 11 / Class 12 Streams (e.g. Science, Commerce, Humanities)
  if (/Class\s*(11|12|XI|XII)/i.test(cleanClass) && /^(Science|Commerce|Humanities|Arts)$/i.test(cleanSection)) {
    return `${cleanClass}-${cleanSection}`;
  }

  // Default Standard Class + Section (e.g. Class 1-A, Class 10-B)
  return `${cleanClass}-${cleanSection}`;
}

export interface ClassSectionSelectProps {
  id?: string;
  name?: string;
  value: string;
  onChange: (sectionId: string, metadata?: ClassSectionOption) => void;
  academicYearId?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function ClassSectionSelect({
  id = 'class-section-select',
  name = 'classSection',
  value,
  onChange,
  academicYearId,
  required = false,
  disabled = false,
  placeholder = 'Select Class / Section…',
  className,
}: ClassSectionSelectProps): ReactNode {
  const schoolId = useSchoolId();

  const classesQuery = useQuery({
    queryKey: ['classes', schoolId],
    queryFn: () => listClasses(schoolId),
    staleTime: 60_000,
  });

  const sectionsQuery = useQuery({
    queryKey: ['sections', schoolId, academicYearId],
    queryFn: () => listSections(schoolId, { academicYearId: academicYearId || undefined }),
    enabled: Boolean(schoolId),
  });

  const options = useMemo<ClassSectionOption[]>(() => {
    if (!sectionsQuery.data?.items) return [];

    const gradeOrderMap = new Map<string, number>();
    if (classesQuery.data?.items) {
      for (const cls of classesQuery.data.items) {
        gradeOrderMap.set(cls.id, cls.gradeOrder ?? 0);
      }
    }

    const list: ClassSectionOption[] = sectionsQuery.data.items.map((sec: SectionRecord) => {
      const gOrder = gradeOrderMap.get(sec.classId) ?? 0;
      return {
        sectionId: sec.id,
        classId: sec.classId,
        className: sec.className,
        sectionName: sec.name,
        label: formatClassSectionLabel(sec.className, sec.name),
        enrolled: sec.enrolled ?? 0,
        capacity: sec.capacity ?? 45,
        gradeOrder: gOrder,
      };
    });

    // Sort by grade order ascending, then section name
    return list.sort((a, b) => {
      if (a.gradeOrder !== b.gradeOrder) return a.gradeOrder - b.gradeOrder;
      return a.sectionName.localeCompare(b.sectionName);
    });
  }, [sectionsQuery.data, classesQuery.data]);

  return (
    <Select
      id={id}
      name={name}
      value={value}
      onChange={(e) => {
        const selectedId = e.target.value;
        const meta = options.find((o) => o.sectionId === selectedId);
        onChange(selectedId, meta);
      }}
      required={required}
      disabled={disabled || sectionsQuery.isPending}
      className={className}
    >
      <option value="">{sectionsQuery.isPending ? 'Loading Class / Sections…' : placeholder}</option>
      {options.map((opt) => (
        <option key={opt.sectionId} value={opt.sectionId}>
          {opt.label} ({opt.enrolled}/{opt.capacity})
        </option>
      ))}
      {!sectionsQuery.isPending && options.length === 0 && (
        <option value="" disabled>
          No classes/sections found
        </option>
      )}
    </Select>
  );
}
