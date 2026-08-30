import type { SimpleRouteJson } from "../../types"
import type {
  HybridLayerRuleInput,
  HybridRoutingRulesInput,
} from "./types"

export type HybridBenchmarkInputPolicy = {
  readonly inferredFields: readonly string[]
  readonly minimumViaHoleDiameterMm: number
  readonly minimumViaPadDiameterMm: number
  readonly defaultClearanceMm: number
}

export type PreparedHybridBenchmarkInput = {
  readonly input: SimpleRouteJson
  readonly policy: HybridBenchmarkInputPolicy
}

const BENCHMARK_VIA_HOLE_DIAMETER_MM = 0.3
const BENCHMARK_MINIMUM_VIA_PAD_DIAMETER_MM = 0.6
const BENCHMARK_DEFAULT_CLEARANCE_MM = 0.15

export function prepareHybridBenchmarkInput(
  source: SimpleRouteJson,
): PreparedHybridBenchmarkInput {
  const inferredFields: string[] = []
  const minimumViaHoleDiameterMm =
    source.min_via_hole_diameter ??
    source.minViaHoleDiameter ??
    inferBenchmarkNumber({
      fieldName: "minViaHoleDiameter",
      value: BENCHMARK_VIA_HOLE_DIAMETER_MM,
      inferredFields,
    })
  const declaredPadDiameterMm =
    source.min_via_pad_diameter ??
    source.minViaPadDiameter ??
    source.minViaDiameter
  const minimumViaPadDiameterMm =
    declaredPadDiameterMm ??
    inferBenchmarkNumber({
      fieldName: "minViaPadDiameter",
      value: Math.max(
        BENCHMARK_MINIMUM_VIA_PAD_DIAMETER_MM,
        minimumViaHoleDiameterMm + source.minTraceWidth * 2,
      ),
      inferredFields,
    })
  if (minimumViaPadDiameterMm <= minimumViaHoleDiameterMm) {
    throw new Error(
      `benchmark input has via pad diameter ${minimumViaPadDiameterMm}mm that is not larger than hole diameter ${minimumViaHoleDiameterMm}mm`,
    )
  }
  const defaultClearanceMm =
    source.defaultObstacleMargin ??
    inferBenchmarkNumber({
      fieldName: "defaultObstacleMargin",
      value: BENCHMARK_DEFAULT_CLEARANCE_MM,
      inferredFields,
    })
  const minTraceToPadEdgeClearance =
    source.minTraceToPadEdgeClearance ??
    inferBenchmarkNumber({
      fieldName: "minTraceToPadEdgeClearance",
      value: defaultClearanceMm,
      inferredFields,
    })
  const minViaEdgeToPadEdgeClearance =
    source.minViaEdgeToPadEdgeClearance ??
    inferBenchmarkNumber({
      fieldName: "minViaEdgeToPadEdgeClearance",
      value: defaultClearanceMm,
      inferredFields,
    })
  const minBoardEdgeClearance =
    source.minBoardEdgeClearance ??
    inferBenchmarkNumber({
      fieldName: "minBoardEdgeClearance",
      value: defaultClearanceMm,
      inferredFields,
    })
  return Object.freeze({
    input: Object.freeze({
      ...source,
      minViaHoleDiameter: minimumViaHoleDiameterMm,
      minViaPadDiameter: minimumViaPadDiameterMm,
      defaultObstacleMargin: defaultClearanceMm,
      minTraceToPadEdgeClearance,
      minViaEdgeToPadEdgeClearance,
      minBoardEdgeClearance,
    }),
    policy: Object.freeze({
      inferredFields: Object.freeze(inferredFields),
      minimumViaHoleDiameterMm,
      minimumViaPadDiameterMm,
      defaultClearanceMm,
    }),
  })
}

export function createHybridBenchmarkRoutingRules(
  input: SimpleRouteJson,
): HybridRoutingRulesInput {
  const layerStack = createConventionalLayerStack(input.layerCount)
  const layerNames = layerStack.map((layer) => layer.name)
  const clearanceMm = input.defaultObstacleMargin ?? input.minTraceWidth
  const routeClasses = input.connections.map((connection) => {
    const traceWidthMm =
      connection.nominalTraceWidth ??
      input.nominalTraceWidth ??
      input.minTraceWidth
    const hardMaximum = Math.max(
      8,
      connection.pointsToConnect.length * Math.max(2, input.layerCount),
    )
    return Object.freeze({
      className: `benchmark:${connection.name}`,
      traceWidthMm,
      allowedLayers: layerNames,
      viaBudget: Object.freeze({
        softMaximum: Math.floor(hardMaximum / 2),
        hardMaximum,
      }),
    })
  })
  return Object.freeze({
    layerStack: Object.freeze(layerStack),
    legalViaSpans: Object.freeze(
      layerNames.flatMap((fromLayer, fromIndex) =>
        layerNames.slice(fromIndex + 1).map((toLayer) =>
          Object.freeze({ fromLayer, toLayer }),
        ),
      ),
    ),
    clearances: Object.freeze({
      traceToTraceMm: clearanceMm,
      traceToPadEdgeMm: clearanceMm,
      viaToTraceEdgeMm:
        input.minViaEdgeToPadEdgeClearance ?? clearanceMm,
      viaToPadEdgeMm:
        input.minViaEdgeToPadEdgeClearance ?? clearanceMm,
      boardEdgeMm: input.minBoardEdgeClearance ?? clearanceMm,
    }),
    routingResolutionMm: Math.min(0.1, input.minTraceWidth / 2),
    routeClasses: Object.freeze(routeClasses),
    connectionClassAssignments: Object.freeze(
      input.connections.map((connection) =>
        Object.freeze({
          connectionName: connection.name,
          className: `benchmark:${connection.name}`,
        }),
      ),
    ),
    powerRules: Object.freeze(
      input.connections
        .filter((connection) => connection.pointsToConnect.length > 2)
        .map((connection) =>
          Object.freeze({
            connectionName: connection.name,
            topology: "tree" as const,
            traceWidthMm:
              connection.nominalTraceWidth ??
              input.nominalTraceWidth ??
              input.minTraceWidth,
            allowedLayers: layerNames,
          }),
        ),
    ),
    preloadedCopperOwnership: Object.freeze(
      (input.traces ?? []).map((trace) =>
        Object.freeze({
          pcbTraceId: trace.pcb_trace_id,
          mutability: "immutable" as const,
        }),
      ),
    ),
  })
}

function createConventionalLayerStack(
  layerCount: number,
): readonly HybridLayerRuleInput[] {
  if (!Number.isSafeInteger(layerCount) || layerCount <= 0) {
    throw new Error("benchmark input layerCount must be a positive safe integer")
  }
  return Object.freeze(
    Array.from({ length: layerCount }, (_, zIndex) =>
      Object.freeze({
        name:
          zIndex === 0
            ? "top"
            : zIndex === layerCount - 1
              ? "bottom"
              : `inner${zIndex}`,
        zIndex,
        preferredDirection:
          zIndex % 2 === 0
            ? ("horizontal" as const)
            : ("vertical" as const),
      }),
    ),
  )
}

function inferBenchmarkNumber({
  fieldName,
  value,
  inferredFields,
}: {
  fieldName: string
  value: number
  inferredFields: string[]
}): number {
  inferredFields.push(fieldName)
  return value
}
