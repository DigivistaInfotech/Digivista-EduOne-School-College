import { z } from 'zod';
import { INDIA_STATES } from './regional';

export const regionalSettingsInput = z.object({
  countryCode: z.literal('IN'),
  stateCode: z.string().refine((value) => INDIA_STATES.some((state) => state.code === value), 'Choose an Indian state or union territory').nullable(),
  defaultLanguage: z.enum(['en', 'hi']),
}).strict();
