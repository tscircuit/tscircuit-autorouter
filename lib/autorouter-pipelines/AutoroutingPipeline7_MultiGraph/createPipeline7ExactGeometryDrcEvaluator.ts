import type { DrcEvaluator } from "high-density-repair03/lib"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import {
  getDrcErrors,
  type GetDrcErrorsOptions,
} from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import {
  convertPipeline7HdRoutesToSimplifiedPcbTraces,
  type ConvertPipeline7HdRoutesOptions,
} from "./convertPipeline7HdRoutesToSimplifiedPcbTraces"

type Pipeline7DrcEvaluatorConversionOptions = Omit<
  ConvertPipeline7HdRoutesOptions,
  "hdRoutes"
> & {
  srjWithPointPairs: Parameters<typeof convertToCircuitJson>[0]
  originalSrj: Parameters<typeof convertToCircuitJson>[0]
}

const createPipeline7DrcEvaluator = (
  conversionOptions: Pipeline7DrcEvaluatorConversionOptions,
  drcOptions: GetDrcErrorsOptions,
): DrcEvaluator => {
  return ({ routes, hdRoutes }) => {
    const evaluatedRoutes = routes ?? hdRoutes
    if (!evaluatedRoutes) {
      throw new Error("Pipeline7 DRC evaluation requires HD routes")
    }

    const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      ...conversionOptions,
      hdRoutes: evaluatedRoutes,
    })
    const circuitJson = convertToCircuitJson(
      conversionOptions.srjWithPointPairs,
      traces,
      {
        minTraceWidth: conversionOptions.originalSrj.minTraceWidth,
        minViaDiameter: conversionOptions.originalSrj.minViaDiameter,
        originalSrj: conversionOptions.originalSrj,
      },
    )
    const { errors, errorsWithCenters } = getDrcErrors(circuitJson, drcOptions)

    return {
      errors: errors as unknown as Record<string, unknown>[],
      errorsWithCenters: errorsWithCenters as unknown as Record<
        string,
        unknown
      >[],
    }
  }
}

/**
 * Scores only exact, movable copper-geometry violations for Pipeline7's final
 * cleanup pass. Connectivity errors are excluded, while overlap and typed
 * clearance reporters are both included because checks classifies each
 * trace-obstacle pair into exactly one category.
 */
export const createPipeline7ExactGeometryDrcEvaluator = (
  conversionOptions: Pipeline7DrcEvaluatorConversionOptions,
): DrcEvaluator =>
  createPipeline7DrcEvaluator(conversionOptions, {
    ...RELAXED_DRC_OPTIONS,
    includeTraceContinuity: false,
  })

/** Uses the benchmark's relaxed DRC rules when validating route checkpoints. */
export const createPipeline7RelaxedDrcEvaluator = (
  conversionOptions: Pipeline7DrcEvaluatorConversionOptions,
): DrcEvaluator =>
  createPipeline7DrcEvaluator(conversionOptions, {
    ...RELAXED_DRC_OPTIONS,
  })
