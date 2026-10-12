import { z } from 'zod';

import { defineEvent } from './event';

/** Platform-level events (BACKEND.md §10.2). */
export const featureFlagChanged = defineEvent({
  type: 'feature_flag.changed',
  version: 1,
  aggregate: 'feature_flag',
  data: z.object({ key: z.string() }),
});
