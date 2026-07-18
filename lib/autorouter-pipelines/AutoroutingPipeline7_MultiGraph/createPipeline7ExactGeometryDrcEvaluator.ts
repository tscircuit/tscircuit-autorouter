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

const getPadIdentifierFromDrcMessage = (
  message: unknown,
): string | undefined => {
  if (typeof message !== "string") return undefined
  const patterns = [
    /pcb_smtpad "pcb_port\[#(pcb_port_[^\]]+)\]"/,
    /Pad pcb_port\[#(pcb_port_[^\]]+)\]/,
    /smtpad\[#(pcb_port_[^\]]+)\]/,
    /pcb_plated_hole "pcb_plated_hole\[#(pcb_plated_hole_[^\]]+)\]"/,
    /Pad pcb_plated_hole\[#(pcb_plated_hole_[^\]]+)\]/,
  ]
  for (const pattern of patterns) {
    const identifier = message.match(pattern)?.[1]
    if (identifier) return identifier
  }
  return undefined
}

const createPipeline7DrcEvaluator = (
  conversionOptions: Pipeline7DrcEvaluatorConversionOptions,
  drcOptions: GetDrcErrorsOptions,
): DrcEvaluator => {
  const routeConversionCache = new WeakMap()

  return ({ routes, hdRoutes }) => {
    const evaluatedRoutes = routes ?? hdRoutes
    if (!evaluatedRoutes) {
      throw new Error("Pipeline7 DRC evaluation requires HD routes")
    }

    const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      ...conversionOptions,
      hdRoutes: evaluatedRoutes,
      routeConversionCache,
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
    const padCenterById = new Map<string, { x: number; y: number }>()
    for (const element of circuitJson) {
      if (element.type !== "pcb_smtpad" && element.type !== "pcb_plated_hole") {
        continue
      }
      const center =
        element.type === "pcb_smtpad" && element.shape === "polygon"
          ? element.points.length > 0
            ? {
                x:
                  element.points.reduce((sum, point) => sum + point.x, 0) /
                  element.points.length,
                y:
                  element.points.reduce((sum, point) => sum + point.y, 0) /
                  element.points.length,
              }
            : undefined
          : { x: element.x, y: element.y }
      if (!center) continue
      const elementId =
        element.type === "pcb_smtpad"
          ? element.pcb_smtpad_id
          : element.pcb_plated_hole_id
      padCenterById.set(elementId, center)
      if (element.pcb_port_id) padCenterById.set(element.pcb_port_id, center)
    }
    const locationAwareErrors = errorsWithCenters.map((error) => {
      const candidate = error as unknown as Record<string, unknown>
      const viaCenter =
        typeof candidate.pcb_via_id === "string"
          ? viaCenterById.get(candidate.pcb_via_id)
          : undefined
      const padIdentifier =
        typeof candidate.pcb_pad_id === "string"
          ? candidate.pcb_pad_id
          : getPadIdentifierFromDrcMessage(candidate.message)
      const padCenter = padIdentifier
        ? padCenterById.get(padIdentifier)
        : undefined
      return viaCenter || padCenter
        ? {
            ...error,
            ...(viaCenter ? { via_center: viaCenter } : {}),
            ...(padCenter ? { pad_center: padCenter } : {}),
          }
        : error
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
