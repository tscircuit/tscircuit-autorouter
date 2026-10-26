import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { Pipeline9RegionalB01RepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalB01RepairSolver"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import {
  createFixedRouteCopperSpatialIndex,
  preparePipeline9RegionalB01Candidate,
  preparePipeline9RegularRegionalCandidate,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"
import type { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
  StaticRouteSegment,
} from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("joint regional candidates retain the original board and declared owners across synthetic splice aliases", (): void => {
  const physicalSrj: SimpleRouteJson = {
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    layerCount: 8,
    minTraceWidth: 0.1,
    allowBlindAndBuriedVias: false,
    connections: [
      { name: "source_signal", pointsToConnect: [] },
      { name: "source_foreign", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: -0.5, y: 0 },
        width: 0.3,
        height: 0.3,
        layers: [
          "top",
          "inner1",
          "inner2",
          "inner3",
          "inner4",
          "inner5",
          "inner6",
          "bottom",
        ],
        connectedTo: ["source_signal", "pcb_plated_hole_own"],
        circuitJsonMetadata: { pcb_plated_hole_id: "pcb_plated_hole_own" },
      },
      {
        type: "rect",
        center: { x: 0.5, y: 0 },
        width: 0.3,
        height: 0.3,
        layers: ["inner4"],
        connectedTo: ["source_foreign", "pcb_smtpad_foreign"],
        circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_foreign" },
      },
    ],
  }
  // Planning geometry is deliberately incomplete and routing aliases merge
  // these nets. Neither may replace the original declared physical ownership.
  const srj = { ...physicalSrj, obstacles: [] }
  const routes: HighDensityRoute[] = [0, 4].map((y) => ({
    connectionName: "pipeline9_preloaded_drc_0",
    rootConnectionName: "connectivity_net_routing",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y, z: 0 },
      { x: 2, y, z: 0 },
    ],
    vias: [],
  }))
  const physicalRootConnectionNameByConnectionName = {
    pipeline9_preloaded_drc_0: "source_signal",
  }
  const original = structuredClone({
    physicalSrj,
    srj,
    routes,
    physicalRootConnectionNameByConnectionName,
  })
  const params = {
    srj,
    physicalSrj,
    routes,
    physicalRootConnectionNameByConnectionName,
    fixedObstacleRoutes: [],
    connMap: new ConnectivityMap({
      connectivity_net_routing: [
        "pipeline9_preloaded_drc_0",
        "source_signal",
        "source_foreign",
      ],
    }),
    colorMap: {},
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    center: { x: 0, y: 0 },
    regionSize: 3,
  }
  const b01 = preparePipeline9RegionalB01Candidate({ ...params, routeIndex: 0 })
  expect(b01).toBeDefined()
  b01!.solver.step()
  const regular = preparePipeline9RegularRegionalCandidate({
    ...params,
    fixedRouteCopperSpatialIndex: createFixedRouteCopperSpatialIndex([], srj),
  })
  expect(regular).toBeDefined()
  const nodeSolvers: HighDensitySolver[] = [
    b01!.solver.activeRegularSolver!,
    regular!.solver.highDensitySolver,
  ]
  for (const solver of nodeSolvers) {
    expect(solver).toBeDefined()
    expect(solver.staticSegmentValidator).toBeFunction()
    expect(solver.growShrinkSolutionValidator).toBeFunction()
    const connectionName =
      solver.unsolvedNodePortPoints[0]!.portPoints[0]!.connectionName
    expect(connectionName).toBe("pipeline9_preloaded_drc_0_regional_0")
    const edge: StaticRouteSegment = {
      connectionName,
      rootConnectionName: "connectivity_net_routing",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      start: { x: -0.5, y: 0, z: 0 },
      end: { x: -0.5, y: 0, z: 1 },
    }
    const whole = (segment: StaticRouteSegment): boolean =>
      solver.growShrinkSolutionValidator!([
        {
          connectionName: segment.connectionName,
          rootConnectionName: segment.rootConnectionName,
          traceThickness: segment.traceThickness,
          viaDiameter: segment.viaDiameter,
          route: [segment.start, segment.end],
          vias: [{ x: segment.start.x, y: segment.start.y }],
        },
      ])
    expect(solver.staticSegmentValidator!(edge)).toBe(true)
    expect(whole(edge)).toBe(true)
    const foreign = {
      ...edge,
      start: { ...edge.start, x: 0.5 },
      end: { ...edge.end, x: 0.5 },
    }
    expect(solver.staticSegmentValidator!(foreign)).toBe(false)
    expect(whole(foreign)).toBe(false)
    const offBoard = {
      ...edge,
      start: { ...edge.start, x: 4.9 },
      end: { ...edge.end, x: 4.9 },
    }
    expect(solver.staticSegmentValidator!(offBoard)).toBe(false)
    expect(whole(offBoard)).toBe(false)
  }
  expect({
    physicalSrj,
    srj,
    routes,
    physicalRootConnectionNameByConnectionName,
  }).toEqual(original)

  const movableTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "preloaded_movable",
    connection_name: "source_signal",
    route: [
      { route_type: "wire", x: -2, y: 2, width: 0.1, layer: "top" },
      { route_type: "wire", x: 2, y: 2, width: 0.1, layer: "top" },
    ],
  }
  const fixedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "preloaded_fixed",
    connection_name: "source_foreign",
    route: [
      { route_type: "wire", x: -2, y: -3, width: 0.1, layer: "top" },
      { route_type: "wire", x: 2, y: -3, width: 0.1, layer: "top" },
    ],
  }
  const jointOriginal: SimpleRouteJson = {
    ...physicalSrj,
    traces: [movableTrace, fixedTrace],
  }
  const changedTrace: SimplifiedPcbTrace = {
    ...movableTrace,
    route: [
      { route_type: "wire", x: -2, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0.5, y: 0, width: 0.1, layer: "top" },
      {
        route_type: "via",
        x: 0.5,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.3,
        via_hole_diameter: 0.15,
      },
      { route_type: "wire", x: 0.5, y: 0, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "bottom" },
    ],
  }
  const newConnections = [
    {
      name: "signal_mst0",
      __rootConnectionNames: ["source_signal"],
      pointsToConnect: [
        { x: -4, y: 4, layer: "top", pointId: "mst_start" },
        { x: -3, y: 4, layer: "top", pointId: "mst_end" },
      ],
    },
    {
      name: "declared_net_alias",
      __netConnectionName: "source_signal",
      pointsToConnect: [
        { x: 3, y: 4, layer: "top", pointId: "net_start" },
        { x: 4, y: 4, layer: "top", pointId: "net_end" },
      ],
    },
  ]
  const newHdRoutes = newConnections.map(
    (connection): HighDensityRoute => ({
      connectionName: connection.name,
      rootConnectionName: "connectivity_net_routing",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: connection.pointsToConnect.map((point) => ({
        x: point.x,
        y: point.y,
        z: 0,
      })),
      vias: [],
    }),
  )
  const jointPlanning = {
    ...jointOriginal,
    connections: [...jointOriginal.connections, ...newConnections],
  }
  const joint = new Pipeline9JointDrcRepairSolver({
    srj: jointPlanning,
    srjWithPointPairs: jointPlanning,
    originalSrj: jointOriginal,
    newConnections,
    newHdRoutes,
    updatedPreloadedTraces: [changedTrace, fixedTrace],
    mutatedPreloadedTraceIds: new Set([changedTrace.pcb_trace_id]),
    connMap: getConnectivityMapFromSimpleRouteJson(jointPlanning),
    obstacles: jointPlanning.obstacles,
    layerCount: 8,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  })
  expect(joint.movablePreloadedSections).toHaveLength(1)
  const synthetic = joint.movablePreloadedSections[0]!
  expect(joint.physicalRootConnectionNameByConnectionName.signal_mst0).toBe(
    "source_signal",
  )
  expect(
    joint.physicalRootConnectionNameByConnectionName.declared_net_alias,
  ).toBe("source_signal")
  expect(
    joint.physicalRootConnectionNameByConnectionName[
      synthetic.syntheticConnectionName
    ],
  ).toBe("source_signal")
  expect(joint.fixedPreloadedObstacleRoutes).toHaveLength(1)
  expect(
    joint.physicalRootConnectionNameByConnectionName[
      joint.fixedPreloadedObstacleRoutes[0]!.connectionName
    ],
  ).toBe("source_foreign")
  // Preserve the unresolved via conflict at the exact-stage boundary. This
  // exercises the actual Joint handoff without executing a repair search.
  const unchangedExactOutput = spyOn(joint.exactRepairSolver!, "getOutput").mockReturnValue([...newHdRoutes, synthetic.hdRoute])
  try {
    joint.pipelineDef.find((stage) => stage.solverName === "exactRepairSolver")!.onSolved()
    const regional = joint.pipelineDef.find((stage) => stage.solverName === "regionalB01RepairSolver")!.createSolver() as Pipeline9RegionalB01RepairSolver
    expect(regional.params.physicalSrj).toBe(jointOriginal)
    expect(regional.params.physicalRootConnectionNameByConnectionName).toBe(joint.physicalRootConnectionNameByConnectionName)
    expect(regional.params.viaHoleDiameter).toBe(0.15)
  } finally {
    unchangedExactOutput.mockRestore()
  }

  const promotedRoute: PreloadedHighDensityRoute = {
    ...routes[0]!, connectionName: "promoted_fixed", preloadedTraceIndex: 0, preloadedRouteIndex: 0,
    route: [{ x: -2, y: 0, z: 7 }, { x: 2, y: 0, z: 7 }],
  }
  const activeNode: NodeWithPortPoints = {
    capacityMeshNodeId: "promoted-fixed-owner", center: { x: 0, y: 0 }, width: 3, height: 3, availableZ: [0],
    portPoints: [{ x: -1.5, y: 1, z: 0, connectionName: "source_foreign", rootConnectionName: "source_foreign" }, { x: 1.5, y: 1, z: 0, connectionName: "source_foreign", rootConnectionName: "source_foreign" }],
  }
  for (const explicitRoots of [{ promoted_fixed: "source_signal" }, undefined]) {
    const main = new Pipeline9HighDensitySolver({
      nodePortPoints: [activeNode], fixedHdRoutes: [promotedRoute], connMap: params.connMap,
      obstacles: [], layerCount: 8, viaDiameter: 0.3, viaHoleDiameter: 0.15, traceWidth: 0.1, obstacleMargin: 0.15, effort: 1,
      physicalSrj: jointOriginal, physicalRootConnectionNameByConnectionName: explicitRoots,
    })
    main.activeNode = activeNode
    const fallbackDriver = main as unknown as { startRegionalFallback: (promoted: ReadonlySet<string>) => void }
    fallbackDriver.startRegionalFallback(new Set([promotedRoute.connectionName]))
    const fallback = main.activeFallbackSolver!
    expect(fallback.params.physicalRootConnectionNameByConnectionName?.promoted_fixed).toBe("source_signal")
    const edge: StaticRouteSegment = { connectionName: promotedRoute.connectionName, rootConnectionName: "connectivity_net_routing", traceThickness: 0.1, viaDiameter: 0.3, start: { x: -0.5, y: 0, z: 0 }, end: { x: -0.5, y: 0, z: 7 } }
    expect(fallback.highDensitySolver.staticSegmentValidator!(edge)).toBe(true)
    expect(fallback.highDensitySolver.growShrinkSolutionValidator!([{ ...promotedRoute, route: [edge.start, edge.end], vias: [{ x: -0.5, y: 0 }] }])).toBe(true)
  }
  const undeclared = new Pipeline9HighDensitySolver({
    nodePortPoints: [activeNode], fixedHdRoutes: [promotedRoute], connMap: params.connMap,
    obstacles: [], layerCount: 8, viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 1, physicalSrj,
  })
  undeclared.activeNode = activeNode
  const undeclaredDriver = undeclared as unknown as { startRegionalFallback: (promoted: ReadonlySet<string>) => void }
  expect(() => undeclaredDriver.startRegionalFallback(new Set([promotedRoute.connectionName]))).toThrow('fixed route "promoted_fixed" has no declared physical owner')
})
