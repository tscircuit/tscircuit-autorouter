/**
 * Ensures a value exists and narrows its type, otherwise throws with context.
 *
 * I prefer this over throwing directly because it is more concise to use.
 */
export function assertDefined<T>(
  value: T | undefined | null,
  message: string,
): asserts value is T {
  if (value === undefined || value === null) {
    throw new Error(message)
  }
}
