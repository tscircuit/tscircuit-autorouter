import { expect, test } from "bun:test"
import { RelaxTraceClearanceSolver } from "@tscircuit/repair04"
import {
  applyDrcErrorForces,
  cloneRoutes,
  getDrcSnapshot,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson as RepairSimpleRouteJson } from "high-density-repair03/lib"
import { Pipeline9ClearanceProjectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionSolver"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { spliceFixedRouteSection } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("anchors repair sections to retained through copper", (): void => {
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "retained_trace",
    connection_name: "retained",
    connectsTo: ["pcb_port_left", "pcb_port_right"],
    route: [
      { route_type: "wire", x: -2, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: -1, y: 0, layer: "top", width: 0.1 },
      {
        route_type: "through_obstacle",
        start: { x: -1, y: 0 },
        end: { x: -1, y: 0 },
        from_layer: "top",
        to_layer: "bottom",
        width: 0.1,
      },
      { route_type: "wire", x: -1, y: 0, layer: "bottom", width: 0.1 },
      { route_type: "wire", x: -0.4, y: 0, layer: "bottom", width: 0.1 },
      { route_type: "wire", x: 0.4, y: 0, layer: "bottom", width: 0.1 },
      { route_type: "wire", x: 1, y: 0, layer: "bottom", width: 0.1 },
      {
        route_type: "through_obstacle",
        start: { x: 1, y: 0 },
        end: { x: 1, y: 0 },
        from_layer: "bottom",
        to_layer: "top",
        width: 0.1,
      },
      { route_type: "wire", x: 1, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 2, y: 0, layer: "top", width: 0.1 },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.45,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    connections: [
      {
        name: "retained",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pcb_port_id: "pcb_port_left" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "pcb_port_right" },
        ],
      },
      {
        name: "foreign",
        pointsToConnect: [
          { x: -0.2, y: 0.03, layer: "bottom" },
          { x: 0.2, y: 0.03, layer: "bottom" },
        ],
      },
    ],
    traces: [trace],
    obstacles: [
      {
        type: "rect",
        shape: "circle",
        layers: ["top", "bottom"],
        center: { x: -1, y: 0 },
        width: 0.45,
        height: 0.45,
        connectedTo: ["pcb_via_left", "retained"],
      },
      {
        type: "rect",
        shape: "circle",
        layers: ["top", "bottom"],
        center: { x: 1, y: 0 },
        width: 0.45,
        height: 0.45,
        connectedTo: ["pcb_via_right", "retained"],
      },
      {
        type: "rect",
        layers: ["bottom"],
        center: { x: 0, y: 0.03 },
        width: 0.2,
        height: 0.2,
        connectedTo: ["pcb_smtpad_foreign", "foreign"],
      },
    ],
  }
  const original = structuredClone(srj)
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const foreign: HighDensityRoute = {
    connectionName: "foreign",
    rootConnectionName: connMap.getNetConnectedToId("foreign"),
    traceThickness: 0.1,
    viaDiameter: 0.45,
    route: [
      { x: -0.2, y: 0.03, z: 1 },
      { x: 0.2, y: 0.03, z: 1 },
    ],
    vias: [],
  }
  const joint = new Pipeline9JointDrcRepairSolver({
    srj,
    originalSrj: srj,
    srjWithPointPairs: srj,
    newConnections: [srj.connections[1]!],
    newHdRoutes: [foreign],
    updatedPreloadedTraces: [trace],
    mutatedPreloadedTraceIds: new Set([trace.pcb_trace_id]),
    connMap,
    obstacles: srj.obstacles,
    layerCount: 2,
    defaultViaDiameter: 0.45,
    defaultViaHoleDiameter: 0.3,
    effort: 1,
    colorMap: {},
  })
  const section = joint.movablePreloadedSections.find(
    (candidate): boolean =>
      candidate.originalTrace.pcb_trace_id === trace.pcb_trace_id &&
      candidate.originalRoutePositionStart === 3 &&
      candidate.originalRoutePositionEnd === 6,
  )
  if (!section) throw new Error("Expected the ordinary section between barrels")
  expect(section.hdRoute.route[0]).toEqual({
    x: -1,
    y: 0,
    z: 1,
    isFixedToCopperBoundary: true,
  })
  expect(section.hdRoute.route.at(-1)).toEqual({
    x: 1,
    y: 0,
    z: 1,
    isFixedToCopperBoundary: true,
  })
  expect(section.hdRoute.route[1]!.isFixedToCopperBoundary).toBeUndefined()
  expect(section.hdRoute.route[2]!.isFixedToCopperBoundary).toBeUndefined()
  expect(section.hdRoute.route.every((point): boolean => !point.pcb_port_id)).toBe(
    true,
  )
  const { traces: _preloadedTraces, ...srjWithoutPreloadedTraces } = srj
  const repairSrj: RepairSimpleRouteJson = {
    ...srjWithoutPreloadedTraces,
    connections: [
      ...srj.connections,
      {
        name: section.syntheticConnectionName,
        rootConnectionName: section.hdRoute.rootConnectionName,
        pointsToConnect: [
          { x: -1, y: 0, layer: "bottom" },
          { x: 1, y: 0, layer: "bottom" },
        ],
      },
    ],
  }
  const repaired = cloneRoutes([section.hdRoute])
  const before = structuredClone(repaired)
  const snapshot = getDrcSnapshot(repairSrj, repaired, undefined, connMap)
  expect(snapshot.count).toBeGreaterThan(0)
  expect(
    applyDrcErrorForces(
      repairSrj,
      repaired,
      snapshot.errors,
      snapshot.traceRouteIndexById,
      1,
      connMap,
    ),
  ).toBe(true)
  expect(repaired[0]!.route[0]).toEqual(before[0]!.route[0])
  expect(repaired[0]!.route.at(-1)).toEqual(before[0]!.route.at(-1))
  expect(repaired[0]!.route).not.toEqual(before[0]!.route)
  expect(repaired[0]!.traceThickness).toBe(0.1)
  expect(repaired[0]!.viaDiameter).toBe(0.45)
  expect(srj).toEqual(original)

  const sourceRoute: PreloadedHighDensityRoute = {
    ...structuredClone(section.hdRoute),
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
  }
  const sourceBefore = structuredClone(sourceRoute)
  const spliced = spliceFixedRouteSection(
    {
      sourceRoutes: [sourceRoute],
      start: { segmentIndex: 0, point: { x: -1, y: 0, z: 1 } },
      end: { segmentIndex: 2, point: { x: 1, y: 0, z: 1 } },
    },
    structuredClone(section.hdRoute),
  )
  expect(spliced.route[0]).toEqual(sourceBefore.route[0])
  expect(spliced.route.at(-1)).toEqual(sourceBefore.route.at(-1))
  const splicedBefore = structuredClone(spliced)
  const splicedSnapshot = getDrcSnapshot(repairSrj, [spliced], undefined, connMap)
  expect(splicedSnapshot.count).toBeGreaterThan(0)
  expect(
    applyDrcErrorForces(
      repairSrj,
      [spliced],
      splicedSnapshot.errors,
      splicedSnapshot.traceRouteIndexById,
      1,
      connMap,
    ),
  ).toBe(true)
  expect(spliced.route[0]).toEqual(splicedBefore.route[0])
  expect(spliced.route.at(-1)).toEqual(splicedBefore.route.at(-1))
  expect(spliced.route).not.toEqual(splicedBefore.route)
  expect(spliced.traceThickness).toBe(sourceBefore.traceThickness)
  expect(sourceRoute).toEqual(sourceBefore)

  for (const flag of [true, false, undefined]) {
    const projectionRoutes = cloneRoutes([section.hdRoute])
    for (const point of [
      projectionRoutes[0]!.route[0]!,
      projectionRoutes[0]!.route.at(-1)!,
    ]) {
      if (flag === undefined) delete point.isFixedToCopperBoundary
      else point.isFixedToCopperBoundary = flag
    }
    const inputRoutes = structuredClone(projectionRoutes)
    const projection = new Pipeline9ClearanceProjectionSolver({
      originalSrj: srj,
      routes: projectionRoutes,
      drcEvaluator: ({ routes }): ReturnType<typeof getDrcSnapshot> => {
        if (!routes) throw new Error("Expected actual projection routes")
        return getDrcSnapshot(repairSrj, routes, undefined, connMap)
      },
    })
    projection.step()
    const native = projection.activeSubSolver
    if (!(native instanceof RelaxTraceClearanceSolver)) {
      throw new Error("Expected the existing native clearance projector")
    }
    expect(native.input.lockedPointIndices).toEqual([
      [flag === true, false, false, flag === true],
    ])
    native.solve()
    expect(native.solved).toBe(true)
    const output = native.getOutput()
    expect(output[0]!.route[0]).toEqual(inputRoutes[0]!.route[0])
    expect(output[0]!.route.at(-1)).toEqual(inputRoutes[0]!.route.at(-1))
    expect(projectionRoutes).toEqual(inputRoutes)
  }
})
