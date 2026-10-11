import { expect, test } from "bun:test"
import { getXyPointKey } from "lib/autorouter-pipelines/AutoroutingPipeline8/getXyPointKey"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { evaluateConnectionCoverage } from "../../scripts/parallel-benchmark/parallelBenchmarkConnectionCoverage"

test("opt-in stitching preserves real terminal layers with permitted colocated vias", (): void => {
  const fragment: HighDensityIntraNodeRoute = {
    connectionName: "net", traceThickness: 0.15, viaDiameter: 0.35,
    route: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }], vias: [],
  }
  const start = { x: 0, y: 0, z: 0, pcb_port_id: "top-port" }
  const end = { x: 2, y: 0, z: 1, pcb_port_id: "bottom-port" }
  const createSingle = (preserveTerminalLayers?: boolean, allowedLayerTransitionPointKeys?: Set<string>): SingleHighDensityRouteStitchSolver3 =>
    new SingleHighDensityRouteStitchSolver3({
      connectionName: "net", start, end, hdRoutes: [structuredClone(fragment)],
      preserveTerminalPcbPortIds: true, preserveTerminalLayers,
      defaultViaDiameter: 0.8, allowedLayerTransitionPointKeys,
      isStitchSegmentClear: () => true, stitchClearanceMode: "require_clear",
    })
  const original = createSingle()
  const explicitlyOriginal = createSingle(false)
  const layerAware = createSingle(true, new Set([getXyPointKey(end)]))
  for (const solver of [original, explicitlyOriginal, layerAware]) {
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
  }
  expect(explicitlyOriginal.mergedHdRoute).toEqual(original.mergedHdRoute)
  expect(original.mergedHdRoute.route.at(-1)!.z).toBe(0)
  expect(original.mergedHdRoute.vias).toEqual([])
  expect(layerAware.mergedHdRoute.route).toEqual([
    { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 1 },
  ])
  expect(layerAware.mergedHdRoute.vias).toEqual([{ x: 2, y: 0 }])
  expect(layerAware.mergedHdRoute.viaDiameter).toBe(0.35)
  expect(layerAware.mergedHdRoute.endPcbPortId).toBe("bottom-port")
  expect(fragment.vias).toEqual([])
  const disallowed = createSingle(true, new Set([getXyPointKey(start)]))
  disallowed.solve()
  expect(disallowed.failed).toBe(true)
  expect(disallowed.solved).toBe(false)
  expect(disallowed.error).toContain("Layer transition")

  const startTransition = new SingleHighDensityRouteStitchSolver3({
    connectionName: "net", start: { ...start, z: 1 }, end: { ...end, x: 3.1, z: 0 },
    hdRoutes: [structuredClone(fragment)], preserveTerminalLayers: true,
    allowedLayerTransitionPointKeys: new Set([getXyPointKey(start)]),
    isStitchSegmentClear: () => true, stitchClearanceMode: "require_clear",
  })
  startTransition.solve()
  expect(startTransition.solved).toBe(true)
  expect(startTransition.mergedHdRoute.route[0]!.z).toBe(1)
  expect(startTransition.mergedHdRoute.route.at(-1)!.z).toBe(0)
  expect(startTransition.mergedHdRoute.vias).toEqual([{ x: 0, y: 0 }])
  const blockedPlanar = new SingleHighDensityRouteStitchSolver3({
    connectionName: "net", start, end, preserveTerminalLayers: true,
    hdRoutes: [{ ...fragment, route: [{ x: 0, y: 0, z: 0 }, { x: 1.5, y: 0, z: 0 }] }],
    isStitchSegmentClear: () => false, stitchClearanceMode: "require_clear",
  })
  blockedPlanar.solve()
  expect(blockedPlanar.failed).toBe(true)
  expect(blockedPlanar.error).toContain("clearance")
  const unreachable = new SingleHighDensityRouteStitchSolver3({
    connectionName: "net", start, end: { ...end, x: 4 }, preserveTerminalLayers: true,
    hdRoutes: [structuredClone(fragment)],
    isStitchSegmentClear: () => true, stitchClearanceMode: "require_clear",
  })
  unreachable.solve()
  expect(unreachable.failed).toBe(true)
  expect(unreachable.solved).toBe(false)
  expect(unreachable.error).toContain("cannot reach")
  expect(() => new SingleHighDensityRouteStitchSolver3({
    connectionName: "net", start, end, preserveTerminalLayers: true,
    hdRoutes: [{ ...fragment, route: [] }],
    isStitchSegmentClear: () => true, stitchClearanceMode: "require_clear",
  })).toThrow("empty route fragment")

  const srj: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.15,
    bounds: { minX: -1, maxX: 3, minY: -1, maxY: 1 },
    connections: [{ name: "net", pointsToConnect: [
      { x: 0, y: 0, layer: "top", pcb_port_id: "top-port" },
      { x: 2, y: 0, layer: "bottom", pcb_port_id: "bottom-port" },
    ] }],
    obstacles: [
      { type: "rect", center: { x: 0, y: 0 }, width: 0.4, height: 0.4, layers: ["top"], connectedTo: ["top-port"] },
      { type: "rect", center: { x: 2, y: 0 }, width: 0.4, height: 0.4, layers: ["bottom"], connectedTo: ["bottom-port"] },
    ],
  }
  const createMultiple = (preserveTerminalLayers?: boolean): MultipleHighDensityRouteStitchSolver3 =>
    new MultipleHighDensityRouteStitchSolver3({
      connections: srj.connections, hdRoutes: [structuredClone(fragment)], layerCount: 2,
      preserveTerminalPcbPortIds: true, snapTerminalsOnSameLayer: true, preserveTerminalLayers,
    })
  const multipleOriginal = createMultiple()
  const multipleExplicitOriginal = createMultiple(false)
  const multipleLayerAware = createMultiple(true)
  for (const solver of [multipleOriginal, multipleExplicitOriginal, multipleLayerAware]) {
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
  }
  expect(multipleExplicitOriginal.mergedHdRoutes).toEqual(multipleOriginal.mergedHdRoutes)
  expect(multipleLayerAware.mergedHdRoutes).toHaveLength(1)
  expect(multipleLayerAware.mergedHdRoutes[0]!.endPcbPortId).toBe("bottom-port")
  expect(multipleLayerAware.mergedHdRoutes[0]!.route.at(-1)!.z).toBe(1)
  const coverage = evaluateConnectionCoverage(srj, convertToCircuitJson(srj, multipleLayerAware.mergedHdRoutes, {
    originalSrj: srj, includeOriginalConnections: true,
  }))
  expect(coverage.summary.requiredPairCount).toBe(1)
  expect(coverage.summary.coveredNetCount).toBe(1)
  expect(coverage.summary.errorCount).toBe(0)
  const coincident = new MultipleHighDensityRouteStitchSolver3({
    connections: [{ name: "coincident", pointsToConnect: [
      { x: 0, y: 0, layer: "top", pcb_port_id: "coincident-top" },
      { x: 0, y: 0, layer: "bottom", pcb_port_id: "coincident-bottom" },
    ] }],
    hdRoutes: [{ ...fragment, connectionName: "coincident", route: [
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 },
    ], vias: [{ x: 0, y: 0 }] }],
    layerCount: 2, preserveTerminalPcbPortIds: true,
    snapTerminalsOnSameLayer: true, preserveTerminalLayers: true,
  })
  coincident.solve()
  expect(coincident.solved).toBe(true)
  expect(coincident.failed).toBe(false)
  expect(coincident.mergedHdRoutes[0]!.startPcbPortId).toBe("coincident-top")
  expect(coincident.mergedHdRoutes[0]!.endPcbPortId).toBe("coincident-bottom")
  expect(coincident.mergedHdRoutes[0]!.route.map((point) => point.z)).toEqual([0, 1])
  expect(coincident.mergedHdRoutes[0]!.vias).toEqual([{ x: 0, y: 0 }])
})
