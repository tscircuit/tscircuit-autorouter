import type { DrcEvaluator } from "high-density-repair03/lib"

/** Circuit errors lead exact repair; final joint validation retains fixed copper. */
export function createPipeline9ReferenceDrcGuard(
  referenceDrcEvaluator: DrcEvaluator,
): DrcEvaluator {
  return Object.assign(
    (input: Parameters<DrcEvaluator>[0]): ReturnType<DrcEvaluator> => {
      const result = referenceDrcEvaluator(input)
      const errors = Array.isArray(result) ? result : result.errors
      const circuitErrors = errors.filter(
        (error) => error.drc_source !== "fixed_copper",
      )
      if (Array.isArray(result)) return circuitErrors
      return {
        ...result,
        errors: circuitErrors,
        errorsWithCenters: result.errorsWithCenters?.filter(
          (error) => error.drc_source !== "fixed_copper",
        ),
      }
    },
    { inputMode: referenceDrcEvaluator.inputMode },
  )
}
