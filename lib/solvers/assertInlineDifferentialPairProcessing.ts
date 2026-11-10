import type { PostProcessingError } from "@tscircuit/length-matching-solver"

export function assertInlineDifferentialPairProcessing(
  sectionNamesByMember: ReadonlyMap<string, string[]>,
  errors: PostProcessingError[],
): void {
  if (sectionNamesByMember.size === 0 || errors.length === 0) return

  const inlineSections = new Set(
    Array.from(sectionNamesByMember.values()).flat(),
  )
  const failure = errors.find((error) => {
    const affectedNames =
      error.connectionNames ??
      (error.connectionName ? [error.connectionName] : undefined)
    return (
      !affectedNames || affectedNames.some((name) => inlineSections.has(name))
    )
  })
  if (failure) {
    throw new Error(
      `Inline differential pair routing failed: ${failure.message}`,
    )
  }
}
