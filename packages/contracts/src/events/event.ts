import { z } from 'zod';

/** Who caused an event or action (data model §1.2 [actor]). */
export const ACTOR_TYPES = [
  'user',
  'customer',
  'platform_admin',
  'agent',
  'system',
  'api_key',
] as const;
export const actorSchema = z
  .object({ type: z.enum(ACTOR_TYPES), id: z.string() })
  .meta({ id: 'Actor' });
export type ActorRef = z.infer<typeof actorSchema>;

/**
 * A domain event type (BACKEND.md §10.1): `<aggregate>.<past_tense_verb>`, versioned payload.
 * Defined once here; producers validate `data` before writing it to the outbox.
 */
export interface EventDefinition<T extends string = string, S extends z.ZodType = z.ZodType> {
  readonly type: T;
  readonly version: number;
  readonly aggregate: string;
  readonly data: S;
}

export function defineEvent<const T extends string, S extends z.ZodType>(
  def: EventDefinition<T, S>,
): EventDefinition<T, S> {
  if (!/^[a-z_]+\.[a-z_]+$/.test(def.type)) throw new Error(`Invalid event type: ${def.type}`);
  return def;
}

/** The envelope every published event carries. */
export const eventEnvelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
  version: z.int().positive(),
  occurredAt: z.iso.datetime(),
  organizationId: z.string().nullable(),
  locationId: z.string().nullable(),
  aggregateType: z.string(),
  aggregateId: z.string(),
  actor: actorSchema,
  data: z.unknown(),
  /** Correlation: request id and W3C trace context of the producing request/job. */
  trace: z.object({ requestId: z.string().optional(), traceparent: z.string().optional() }),
});
export type EventEnvelope<D = unknown> = Omit<z.infer<typeof eventEnvelopeSchema>, 'data'> & {
  data: D;
};
