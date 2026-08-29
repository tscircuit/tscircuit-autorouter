import type { SimpleRouteJson } from "lib/types"
import type { HybridRoutingRulesInput } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/types"
import { compileRoutingRules } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/compile-routing-rules"
import { buildTypedRoutingProblem } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/build-typed-routing-problem"
import type {
  TypedRoutingProblem,
} from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/types"
import type {
  HybridCopperPoint,
  HybridTransactionDelta,
} from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-types"

export function createHybridRoutingTestFixture(): {
  simpleRouteJson: SimpleRouteJson
  routingRules: HybridRoutingRulesInput
} {
  const connectionNames = [
    "diff_positive",
    "diff_negative",
    "bus_0",
    "bus_1",
    "power_vcc",
    "signal_plain",
  ]
  const simpleRouteJson: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.12,
    minViaHoleDiameter: 0.2,
    minViaPadDiameter: 0.4,
    bounds: { minX: -10, maxX: 10, minY: -8, maxY: 8 },
    obstacles: [
      {
        obstacleId: "pad_obstacle",
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        connectedTo: ["signal_plain"],
      },
    ],
    connections: connectionNames.map((connectionName, connectionIndex) => ({
      name: connectionName,
      nominalTraceWidth: connectionName === "signal_plain" ? 0.18 : undefined,
      pointsToConnect: [
        {
          x: -8,
          y: connectionIndex - 2.5,
          layer: "top",
          pointId: `${connectionName}_start`,
        },
        {
          x: 8,
          y: connectionIndex - 2.5,
          layer: "top",
          pointId: `${connectionName}_end`,
        },
      ],
    })),
    differentialPairs: [
      {
        connectionNames: ["diff_positive", "diff_negative"],
        lengthTolerance: 0.08,
        traceGap: 0.18,
        maxUncoupledLength: 1.5,
      },
    ],
    buses: [
      {
        busId: "control_bus",
        connectionNames: ["bus_0", "bus_1"],
        maxLengthSkew: 0.25,
        traceWidth: 0.16,
        allowedLayers: ["top", "inner1"],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "preloaded_signal_plain",
        connection_name: "signal_plain",
        route: [
          {
            route_type: "wire",
            x: -8,
            y: 3.5,
            width: 0.18,
            layer: "top",
          },
          {
            route_type: "via",
            x: -6,
            y: 3.5,
            from_layer: "top",
            to_layer: "bottom",
          },
          {
            route_type: "wire",
            x: -4,
            y: 3.5,
            width: 0.18,
            layer: "bottom",
          },
        ],
      },
    ],
  }
  const routingRules: HybridRoutingRulesInput = {
    layerStack: [
      { name: "top", zIndex: 0, preferredDirection: "horizontal" },
      { name: "inner1", zIndex: 1, preferredDirection: "vertical" },
      { name: "inner2", zIndex: 2, preferredDirection: "horizontal" },
      { name: "bottom", zIndex: 3, preferredDirection: "vertical" },
    ],
    legalViaSpans: [
      { fromLayer: "top", toLayer: "bottom" },
      { fromLayer: "top", toLayer: "inner1" },
      { fromLayer: "inner1", toLayer: "inner2" },
      { fromLayer: "inner2", toLayer: "bottom" },
    ],
    clearances: {
      traceToTraceMm: 0.15,
      traceToPadEdgeMm: 0.15,
      viaToTraceEdgeMm: 0.15,
      viaToPadEdgeMm: 0.15,
      boardEdgeMm: 0.2,
    },
    routingResolutionMm: 0.05,
    routeClasses: [
      {
        className: "signal",
        traceWidthMm: 0.15,
        allowedLayers: ["top", "inner1", "inner2", "bottom"],
        viaBudget: { softMaximum: 3, hardMaximum: 5 },
      },
      {
        className: "power",
        traceWidthMm: 0.4,
        allowedLayers: ["top", "bottom"],
        viaBudget: { softMaximum: 1, hardMaximum: 2 },
      },
    ],
    connectionClassAssignments: connectionNames.map((connectionName) => ({
      connectionName,
      className: connectionName === "power_vcc" ? "power" : "signal",
    })),
    powerRules: [
      {
        connectionName: "power_vcc",
        topology: "tree",
        traceWidthMm: 0.5,
        allowedLayers: ["top", "bottom"],
      },
    ],
    preloadedCopperOwnership: [
      {
        pcbTraceId: "preloaded_signal_plain",
        mutability: "mutable",
        ownerConnectionNames: ["signal_plain"],
      },
    ],
  }
  return { simpleRouteJson, routingRules }
}

export function createHybridRoutingTestProblem(): TypedRoutingProblem {
  const { simpleRouteJson, routingRules } = createHybridRoutingTestFixture()
  return buildTypedRoutingProblem(
    compileRoutingRules({ simpleRouteJson, routingRules }),
  )
}

export function createHybridUncoupledRoutingTestProblem(): TypedRoutingProblem {
  const { simpleRouteJson, routingRules } = createHybridRoutingTestFixture()
  return buildTypedRoutingProblem(
    compileRoutingRules({
      simpleRouteJson: {
        ...simpleRouteJson,
        differentialPairs: [],
        buses: [],
      },
      routingRules: { ...routingRules, powerRules: [] },
    }),
  )
}

export function createHybridSegmentTransaction({
  problem,
  transactionId,
  connectionName,
  start,
  end,
  baseCopperVersion = 0,
  connectedTerminalIds = [],
}: {
  problem: TypedRoutingProblem
  transactionId: string
  connectionName: string
  start: HybridCopperPoint
  end: HybridCopperPoint
  baseCopperVersion?: number
  connectedTerminalIds?: readonly string[]
}): HybridTransactionDelta {
  const connection = problem.compiledRules.connections.find(
    (candidate) => candidate.connectionName === connectionName,
  )
  const ownership = problem.ownershipByConnection.find(
    (candidate) => candidate.connectionName === connectionName,
  )
  if (!connection || !ownership) {
    throw new Error(`test fixture has no connection ${connectionName}`)
  }
  const copperId = `${transactionId}:segment`
  return {
    transactionId,
    regionId: `region:${transactionId}`,
    ownerRouteObjectId: ownership.ownerRouteObjectId,
    baseCopperVersion,
    boundaryContractVersion: 0,
    addedTraces: [
      {
        kind: "segment",
        copperId,
        connectionName,
        layer: connection.allowedLayers[0]!,
        start,
        end,
        widthMm: connection.traceWidthMm,
        ownership: {
          mutability: "mutable",
          ownerRouteObjectIds: [ownership.ownerRouteObjectId],
        },
      },
    ],
    removedOwnedTraceIds: [],
    addedVias: [],
    removedOwnedViaIds: [],
    connectivityEffects: {
      connectionNames: [connectionName],
      connectedTerminalIds,
    },
    affectedBounds: problem.compiledRules.boardBounds,
    candidateCost: {
      viaCount: 0,
      totalLengthMm: Math.hypot(end.x - start.x, end.y - start.y),
      bendCount: 0,
      congestionCost: 0,
      softViaBudgetExceeded: false,
    },
    work: {
      searchExpansions: 1,
      spatialIndexQueries: 0,
      drcPredicateCalls: 0,
      geometryAllocations: 1,
      candidatesConstructed: 1,
      candidatesStepped: 1,
      activeRings: 1,
      solverStateRebuilds: 0,
    },
    diagnostic: {
      code: "candidate_complete",
      message: "test candidate",
      regionIds: [`region:${transactionId}`],
      connectionNames: [connectionName],
    },
  }
}

export function createHybridViaTransaction({
  problem,
  transactionId,
  connectionName,
  points,
  fromLayer = "top",
  toLayer = "bottom",
  baseCopperVersion = 0,
}: {
  problem: TypedRoutingProblem
  transactionId: string
  connectionName: string
  points: readonly HybridCopperPoint[]
  fromLayer?: string
  toLayer?: string
  baseCopperVersion?: number
}): HybridTransactionDelta {
  const connection = problem.compiledRules.connections.find(
    (candidate) => candidate.connectionName === connectionName,
  )
  const ownership = problem.ownershipByConnection.find(
    (candidate) => candidate.connectionName === connectionName,
  )
  if (!connection || !ownership) {
    throw new Error(`test fixture has no connection ${connectionName}`)
  }
  return {
    transactionId,
    regionId: `region:${transactionId}`,
    ownerRouteObjectId: ownership.ownerRouteObjectId,
    baseCopperVersion,
    boundaryContractVersion: 0,
    addedTraces: [],
    removedOwnedTraceIds: [],
    addedVias: points.map((point, pointIndex) => ({
      kind: "via",
      copperId: `${transactionId}:via:${pointIndex}`,
      connectionName,
      x: point.x,
      y: point.y,
      fromLayer,
      toLayer,
      padDiameterMm: problem.compiledRules.viaPadDiameterMm,
      holeDiameterMm: problem.compiledRules.viaHoleDiameterMm,
      ownership: {
        mutability: "mutable",
        ownerRouteObjectIds: [ownership.ownerRouteObjectId],
      },
    })),
    removedOwnedViaIds: [],
    connectivityEffects: {
      connectionNames: [connectionName],
      connectedTerminalIds: [],
    },
    affectedBounds: problem.compiledRules.boardBounds,
    candidateCost: {
      viaCount: points.length,
      totalLengthMm: 0,
      bendCount: 0,
      congestionCost: 0,
      softViaBudgetExceeded: points.length > connection.viaBudget.softMaximum,
      softViaBudgetJustification:
        points.length > connection.viaBudget.softMaximum
          ? "test exercises compiled via-budget validation"
          : undefined,
    },
    work: {
      searchExpansions: 1,
      spatialIndexQueries: 0,
      drcPredicateCalls: 0,
      geometryAllocations: points.length,
      candidatesConstructed: 1,
      candidatesStepped: 1,
      activeRings: 1,
      solverStateRebuilds: 0,
    },
    diagnostic: {
      code: "candidate_complete",
      message: "test candidate",
      regionIds: [`region:${transactionId}`],
      connectionNames: [connectionName],
    },
  }
}
