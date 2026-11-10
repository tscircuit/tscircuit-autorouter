import type { PostProcessingSolver } from "@tscircuit/length-matching-solver"

type PostProcessingError =
  ReturnType<PostProcessingSolver["getOutput"]>["postProcessingErrors"][number]

export function assertInlineDifferentialPairProcessing(
  sectionNames: readonly string[],
  errors: PostProcessingError[],
): void {
  if (sectionNames.length === 0 || errors.length === 0) return

  const inlineSections = new Set(sectionNames)
  const failure = errors.find((error) => {
    const affectedNames =
      error.connectionNames ??
      (error.connectionName ? [error.connectionName] : undefined)
    return !affectedNames || affectedNames.some((name) => inlineSections.has(name))
  })
  if (failure) {
    throw new Error(`Inline differential pair routing failed: ${failure.message}`)
  }
}
