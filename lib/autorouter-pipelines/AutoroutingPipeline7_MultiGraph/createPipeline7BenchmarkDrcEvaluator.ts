import type { DrcEvaluator } from "high-density-repair03/lib"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  convertPipeline7HdRoutesToSimplifiedPcbTraces,
  type ConvertPipeline7HdRoutesOptions,
} from "./convertPipeline7HdRoutesToSimplifiedPcbTraces"

type DrcError = Record<string, unknown>

const getUndersizedTerminalPadViaErrors = (
  hdRoutes: HighDensityRoute[],
  obstacles: Obstacle[],
): DrcError[] => {
  const errors: DrcError[] = []

  for (const hdRoute of hdRoutes) {
    for (
      let pointIndex = 0;
      pointIndex < hdRoute.route.length - 1;
      pointIndex++
    ) {
      const currentPoint = hdRoute.route[pointIndex]!
      const nextPoint = hdRoute.route[pointIndex + 1]!
      if (
        currentPoint.z === nextPoint.z ||
        currentPoint.x !== nextPoint.x ||
        currentPoint.y !== nextPoint.y
      ) {
        continue
      }

      const terminalPoint = currentPoint.pcb_port_id
        ? currentPoint
        : nextPoint.pcb_port_id
          ? nextPoint
          : undefined
      if (!terminalPoint?.pcb_port_id) continue

      const terminalPad = obstacles.find(
        (obstacle) =>
          obstacle.layers.length === 1 &&
          obstacle.connectedTo.includes(terminalPoint.pcb_port_id!) &&
          terminalPoint.x >= obstacle.center.x - obstacle.width / 2 &&
          terminalPoint.x <= obstacle.center.x + obstacle.width / 2 &&
          terminalPoint.y >= obstacle.center.y - obstacle.height / 2 &&
          terminalPoint.y <= obstacle.center.y + obstacle.height / 2,
      )
      if (
        !terminalPad ||
        (terminalPad.width >= hdRoute.viaDiameter &&
          terminalPad.height >= hdRoute.viaDiameter)
      ) {
        continue
      }

      errors.push({
        type: "pcb_via_terminal_pad_fit_error",
        // GlobalDrcForceImproveSolver derives severity from these measurements.
        // An impossible physical fit must outrank every repairable clearance.
        message: `Via diameter ${hdRoute.viaDiameter}mm exceeds terminal pad ${terminalPad.width}x${terminalPad.height}mm; gap: -1000mm required: ${hdRoute.viaDiameter}mm`,
        center: { x: terminalPoint.x, y: terminalPoint.y },
      })
    }
  }

  return errors
}

/** Scores candidates with the same conversion and DRC options as benchmark-run-task. */
export const createPipeline7BenchmarkDrcEvaluator = (
  conversionOptions: Omit<ConvertPipeline7HdRoutesOptions, "hdRoutes"> & {
    srjWithPointPairs: Parameters<typeof convertToCircuitJson>[0]
    originalSrj: Parameters<typeof convertToCircuitJson>[0]
  },
): DrcEvaluator => {
  return ({ routes, hdRoutes }) => {
    const evaluatedRoutes = routes ?? hdRoutes
    if (!evaluatedRoutes) {
      throw new Error("Benchmark DRC evaluation requires HD routes")
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
    const { errors, errorsWithCenters } = getDrcErrors(
      circuitJson,
      RELAXED_DRC_OPTIONS,
    )
    const terminalPadViaErrors = getUndersizedTerminalPadViaErrors(
      evaluatedRoutes,
      conversionOptions.obstacles,
    )

    return {
      errors: [...(errors as unknown as DrcError[]), ...terminalPadViaErrors],
      errorsWithCenters: [
        ...(errorsWithCenters as unknown as DrcError[]),
        ...terminalPadViaErrors,
      ],
    }
  }
}
