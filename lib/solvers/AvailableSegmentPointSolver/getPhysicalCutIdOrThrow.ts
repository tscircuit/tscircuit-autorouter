/** Validate an explicitly supplied finite physical-cut resource identity. */
export function getPhysicalCutIdOrThrow(
  physicalCutId: unknown,
  portId: string,
): string | undefined {
  if (physicalCutId === undefined) return undefined
  if (typeof physicalCutId !== "string" || physicalCutId.trim().length === 0) {
    throw new Error(
      `Invalid physicalCutId for port "${portId}": expected a nonempty string`,
    )
  }
  return physicalCutId
}
