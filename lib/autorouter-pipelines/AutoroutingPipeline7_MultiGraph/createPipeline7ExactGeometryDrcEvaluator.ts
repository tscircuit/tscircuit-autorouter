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
      },
    )
    const { errors, errorsWithCenters } = getDrcErrors(circuitJson, drcOptions)
    const viaCenterById = new Map(
      circuitJson.flatMap((element) =>
        element.type === "pcb_via"
          ? [[element.pcb_via_id, { x: element.x, y: element.y }] as const]
          : [],
      ),
    )
    const locationAwareErrors = errorsWithCenters.map((error) => {
      const candidate = error as unknown as Record<string, unknown>
      const viaCenter =
        typeof candidate.pcb_via_id === "string"
          ? viaCenterById.get(candidate.pcb_via_id)
          : undefined
      return viaCenter ? { ...error, via_center: viaCenter } : error
    })

    return {
      errors: errors as unknown as Record<string, unknown>[],
      errorsWithCenters: locationAwareErrors as unknown as Record<
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
  conversionOptions: Omit<ConvertPipeline7HdRoutesOptions, "hdRoutes"> & {
    srjWithPointPairs: Parameters<typeof convertToCircuitJson>[0]
    originalSrj: Parameters<typeof convertToCircuitJson>[0]
  },
): DrcEvaluator =>
  createPipeline7DrcEvaluator(conversionOptions, {
    ...RELAXED_DRC_OPTIONS,
    includeTraceContinuity: false,
  })

/**
 * Uses the same relaxed DRC reporters as the benchmark. This evaluator is for
 * checkpoint validation, so high effort can never trade benchmark DRC quality
 * for a geometry-only improvement.
 */
export const createPipeline7RelaxedDrcEvaluator = (
  conversionOptions: Pipeline7DrcEvaluatorConversionOptions,
): DrcEvaluator =>
  createPipeline7DrcEvaluator(conversionOptions, {
    ...RELAXED_DRC_OPTIONS,
  })
