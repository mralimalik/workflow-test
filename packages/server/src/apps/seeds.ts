import type { Seed } from '../kernel/db/seeds/seed';
import { platformTemplatesSeed } from '../modules/notifications/notifications.public';

/**
 * Seeds in execution order (composition root: seeds live with the module that owns their
 * table). Added per milestone: A5 admin CLI, A6 plans, A8 system roles, A9 demo tenant.
 */
export const seeds: readonly Seed[] = [platformTemplatesSeed];
