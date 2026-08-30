import { expect, test } from "bun:test"
import {
  getPipeline9PreloadRepairTraceIds,
  Pipeline9JointDrcRepairSolver,
  remapDrcTraceIds,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { isPipeline9DrcErrorOwnedByPreloadRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { normalizePipeline9DrcErrorsForRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/normalizePipeline9DrcErrorsForRepair"
import type {
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

type ExactPathStats = {
  maxIterations: number
  viaInPadMaxIterations: number
  broadMaxIterations: number
  fastProbeAttempted: boolean
  terminalEscapeCandidateCount: number
  regionalB01RepairAttempted: boolean
}

const createEndpointPad = (
  x: number,
  y: number,
  pcbPortId: string,
): Obstacle => ({
  type: "rect",
  center: { x, y },
  width: 0.5,
  height: 0.5,
  layers: ["top"],
  connectedTo: [pcbPortId],
  circuitJsonMetadata: {
    pcb_smtpad_id: `pad_${pcbPortId}`,
    pcb_port_id: pcbPortId,
  },
})

const createPreloadedTrace = (y: number): SimplifiedPcbTrace => ({
  type: "pcb_trace",
  pcb_trace_id: "route_0",
  connection_name: "preloaded",
  connectsTo: ["preloaded_start", "preloaded_end"],
  route: [
    { route_type: "wire", x: -2, y, width: 0.1, layer: "top" },
    { route_type: "wire", x: 2, y, width: 0.1, layer: "top" },
  ],
})

const createJointRepairSolver = ({
  newRouteY,
  updatedPreloadY,
  preloadWasMutated,
  includePreload = true,
}: {
  newRouteY: number
  updatedPreloadY: number
  preloadWasMutated: boolean
  includePreload?: boolean
}): Pipeline9JointDrcRepairSolver => {
  const newConnection: SimpleRouteConnection = {
    name: "route",
    pointsToConnect: [
      {
        x: -2,
        y: newRouteY,
        layer: "top",
        pointId: "route_start",
        pcb_port_id: "route_start",
      },
      {
        x: 2,
        y: newRouteY,
        layer: "top",
        pointId: "route_end",
        pcb_port_id: "route_end",
      },
    ],
  }
  const preloadedConnection: SimpleRouteConnection = {
    name: "preloaded",
    pointsToConnect: [
      {
        x: -2,
        y: 3,
        layer: "top",
        pointId: "preloaded_start",
        pcb_port_id: "preloaded_start",
      },
      {
        x: 2,
        y: 3,
        layer: "top",
        pointId: "preloaded_end",
        pcb_port_id: "preloaded_end",
      },
    ],
  }
  const obstacles: Obstacle[] = [
    createEndpointPad(-2, newRouteY, "route_start"),
    createEndpointPad(2, newRouteY, "route_end"),
    ...(includePreload
      ? [
          createEndpointPad(-2, 3, "preloaded_start"),
          createEndpointPad(2, 3, "preloaded_end"),
        ]
      : []),
    {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 0.5,
      height: 0.5,
      layers: ["top"],
      connectedTo: ["foreign_net"],
      circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_foreign" },
    },
  ]
  const originalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -3, minY: -4, maxX: 3, maxY: 4 },
    obstacles,
    connections: [
      newConnection,
      ...(includePreload ? [preloadedConnection] : []),
    ],
    traces: includePreload ? [createPreloadedTrace(3)] : [],
  }
  const newHdRoute: HighDensityRoute = {
    connectionName: "route",
    rootConnectionName: "route",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: newRouteY, z: 0, pcb_port_id: "route_start" },
      { x: 2, y: newRouteY, z: 0, pcb_port_id: "route_end" },
    ],
    vias: [],
  }

  return new Pipeline9JointDrcRepairSolver({
    srj: originalSrj,
    srjWithPointPairs: originalSrj,
    originalSrj,
    newConnections: [newConnection],
    newHdRoutes: [newHdRoute],
    updatedPreloadedTraces: includePreload
      ? [createPreloadedTrace(updatedPreloadY)]
      : [],
    mutatedPreloadedTraceIds:
      includePreload && preloadWasMutated ? new Set(["route_0"]) : new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(originalSrj),
    obstacles,
    layerCount: 2,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: { route: "red", preloaded: "blue" },
  })
}

test("Pipeline9 joint DRC distinguishes a new trace id from its preloaded alias", () => {
  const noPreloadSolver = createJointRepairSolver({
    newRouteY: 0,
    updatedPreloadY: 3,
    preloadWasMutated: false,
    includePreload: false,
  })
  const newRouteErrorSolver = createJointRepairSolver({
    newRouteY: 0,
    updatedPreloadY: 3,
    preloadWasMutated: false,
  })
  expect(Number(newRouteErrorSolver.stats.initialJointDrcIssueCount)).toBe(1)
  expect(newRouteErrorSolver.movablePreloadedSections).toHaveLength(0)
  expect(newRouteErrorSolver.getMutatedPreloadedTraces()).toEqual([])
  const collisionAwarePreloadTraceIds = getPipeline9PreloadRepairTraceIds({
    routes: newRouteErrorSolver.inputNewHdRoutes,
    newConnections: newRouteErrorSolver.params.newConnections,
    syntheticConnectionNames: newRouteErrorSolver.syntheticConnectionNames,
    fixedPreloadedObstacleRoutes:
      newRouteErrorSolver.fixedPreloadedObstacleRoutes,
    updatedPreloadedTraces: newRouteErrorSolver.params.updatedPreloadedTraces,
  })
  expect(collisionAwarePreloadTraceIds.has("route_0")).toBeFalse()
  expect(collisionAwarePreloadTraceIds.collidingFixedTraceIds).toEqual(
    new Set(["route_0"]),
  )
  expect(
    isPipeline9DrcErrorOwnedByPreloadRepair({
      error: {
        type: "pcb_pad_trace_clearance_error",
        pcb_trace_id: "route_0",
      },
      preloadRepairTraceIds: collisionAwarePreloadTraceIds,
    }),
  ).toBeFalse()
  expect(
    isPipeline9DrcErrorOwnedByPreloadRepair({
      error: remapDrcTraceIds(
        [
          {
            type: "pcb_trace_error",
            pcb_trace_id: "route_0",
            pcb_trace_error_id: "overlap_route_0_route_0_routed",
          },
        ],
        new Map([["route_0_routed", "route_0"]]),
      )[0]!,
      preloadRepairTraceIds: collisionAwarePreloadTraceIds,
    }),
  ).toBeTrue()
  const [normalizedTraceViaCollision] = normalizePipeline9DrcErrorsForRepair({
    errors: remapDrcTraceIds(
      [
        {
          type: "pcb_trace_error",
          pcb_trace_id: "route_0_routed",
          pcb_trace_ids: ["route_0_routed", "route_0"],
          pcb_via_id: "via_0",
          pcb_via_ids: ["via_0"],
          pcb_trace_error_id: "overlap_route_0_routed_via_0",
        },
      ],
      new Map([["route_0_routed", "route_0"]]),
    ),
    circuitJson: [
      {
        type: "pcb_via",
        pcb_via_id: "via_0",
        pcb_trace_id: "route_0",
        x: 0,
        y: 0,
        outer_diameter: 0.3,
        hole_diameter: 0.15,
        layers: ["top", "bottom"],
      },
    ],
    newTraceIds: new Set(["route_0"]),
  })
  expect(normalizedTraceViaCollision?.pcb_trace_ids).toEqual(["route_0"])
  expect(normalizedTraceViaCollision?.__collapsed_trace_participants).toEqual([
    {
      solverTraceId: "route_0",
      evaluationTraceIds: ["route_0_routed", "route_0"],
    },
  ])
  expect(
    isPipeline9DrcErrorOwnedByPreloadRepair({
      error: normalizedTraceViaCollision!,
      preloadRepairTraceIds: collisionAwarePreloadTraceIds,
    }),
  ).toBeTrue()
  noPreloadSolver.solve()
  newRouteErrorSolver.solve()
  const getExactPathStats = (
    solver: Pipeline9JointDrcRepairSolver,
  ): ExactPathStats => ({
    maxIterations: Number(solver.stats.exactRepairConfiguredMaxIterations),
    viaInPadMaxIterations: Number(
      solver.stats.exactRepairConfiguredViaInPadMaxIterations,
    ),
    broadMaxIterations: Number(
      solver.stats.exactRepairConfiguredBroadMaxIterations,
    ),
    fastProbeAttempted: Boolean(
      solver.stats.pipeline7AdaptiveExactDrcFastProbeAttempted,
    ),
    terminalEscapeCandidateCount: Number(
      solver.stats.terminalEscapeCandidateCount,
    ),
    regionalB01RepairAttempted: Boolean(
      solver.stats.regionalB01RepairAttempted,
    ),
  })
  expect(getExactPathStats(noPreloadSolver)).toEqual({
    maxIterations: 32,
    viaInPadMaxIterations: 32,
    broadMaxIterations: 12,
    fastProbeAttempted: true,
    terminalEscapeCandidateCount: 0,
    regionalB01RepairAttempted: false,
  })
  expect(getExactPathStats(newRouteErrorSolver)).toEqual(
    getExactPathStats(noPreloadSolver),
  )

  const preparedPreloadAliasErrorSolver = createJointRepairSolver({
    newRouteY: -2,
    updatedPreloadY: 0,
    preloadWasMutated: true,
  })
  expect(
    Number(preparedPreloadAliasErrorSolver.stats.initialJointDrcIssueCount),
  ).toBeGreaterThan(0)
  expect(
    preparedPreloadAliasErrorSolver.movablePreloadedSections.map(
      (section) => section.originalTrace.pcb_trace_id,
    ),
  ).toEqual(["route_0"])
  expect(
    preparedPreloadAliasErrorSolver
      .getMutatedPreloadedTraces()
      .map((trace) => trace.pcb_trace_id),
  ).toEqual(["route_0"])
  preparedPreloadAliasErrorSolver.solve()
  expect(
    Number(
      preparedPreloadAliasErrorSolver.stats
        .regionalB01RepairPreloadEligibleDrcIssueCount,
    ),
  ).toBeGreaterThan(0)
  expect(
    preparedPreloadAliasErrorSolver.stats.regionalB01RepairAttempted,
  ).toBeTrue()
})
