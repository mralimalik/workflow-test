/** Compile-time exhaustiveness check for discriminated unions and enums. */
export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

/** Narrowing filter: `items.filter(isDefined)` drops `null` and `undefined`. */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
