import { expect, test } from "bun:test"
import type { Point3 } from "@tscircuit/math-utils"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { snapIslandEndpointToNearestTerminal } from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { evaluateConnectionCoverage } from "../../scripts/parallel-benchmark/parallelBenchmarkConnectionCoverage"

test("opt-in terminal snapping preserves physical endpoint layers and coincident-terminal vias", (): void => {
  const island: Point3 = { x: 0, y: 0, z: 1 }
  const wrongLayer: Point3 = { x: 0, y: 0, z: 0 }
  const sameLayer: Point3 = { x: 0.25, y: 0, z: 1 }
  const terminals = [sameLayer, wrongLayer]
  expect(snapIslandEndpointToNearestTerminal({ islandEndpoint: island, terminals })).toBe(wrongLayer)
  expect(snapIslandEndpointToNearestTerminal({ islandEndpoint: island, terminals, requireSameLayer: false })).toBe(wrongLayer)
  expect(snapIslandEndpointToNearestTerminal({ islandEndpoint: island, terminals, requireSameLayer: true })).toBe(sameLayer)
  expect(terminals).toEqual([sameLayer, wrongLayer])
  expect(snapIslandEndpointToNearestTerminal({ islandEndpoint: island, terminals: [wrongLayer], requireSameLayer: true })).toBe(island)
  expect(snapIslandEndpointToNearestTerminal({ islandEndpoint: island, terminals: [], requireSameLayer: true })).toBe(island)
  expect(snapIslandEndpointToNearestTerminal({ islandEndpoint: island, terminals: [{ x: 1.250001, y: 0, z: 1 }], requireSameLayer: true })).toBe(island)
  const left: Point3 = { x: -0.4, y: 0, z: 1 }
  const right: Point3 = { x: 0.4, y: 0, z: 1 }
  for (const tiedTerminals of [[right, left], [left, right]]) {
    expect(snapIslandEndpointToNearestTerminal({ islandEndpoint: island, terminals: tiedTerminals, requireSameLayer: true })).toBe(left)
  }

  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    connections: [{ name: "net", pointsToConnect: [
      { x: 0, y: 0, layer: "top", pcb_port_id: "top-port" },
      { x: 0, y: 0, layer: "bottom", pcb_port_id: "bottom-port" },
    ] }],
    obstacles: [
      { type: "rect", center: { x: 0, y: 0 }, width: 0.4, height: 0.4, layers: ["top"], connectedTo: ["top-port"] },
      { type: "rect", center: { x: 0, y: 0 }, width: 0.4, height: 0.4, layers: ["bottom"], connectedTo: ["bottom-port"] },
    ],
  }
  const route: HighDensityIntraNodeRoute = {
    connectionName: "net",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }],
    vias: [{ x: 0, y: 0 }],
  }
  const createSolver = (snapTerminalsOnSameLayer?: boolean, preserveTerminalPcbPortIds = false): MultipleHighDensityRouteStitchSolver3 =>
    new MultipleHighDensityRouteStitchSolver3({ connections: srj.connections,
      hdRoutes: [structuredClone(route)], layerCount: srj.layerCount,
      preserveTerminalPcbPortIds, snapTerminalsOnSameLayer,
    })
  const original = createSolver()
  const explicitlyOriginal = createSolver(false)
  const layerAware = createSolver(true)
  const layerAwareWithTerminalIds = createSolver(true, true)
  expect(original.unsolvedRoutes[0]!.start.z).toBe(0)
  expect(original.unsolvedRoutes[0]!.end.z).toBe(0)
  expect(layerAware.unsolvedRoutes[0]!.start.z).toBe(0)
  expect(layerAware.unsolvedRoutes[0]!.end.z).toBe(1)
  for (const solver of [original, explicitlyOriginal, layerAware, layerAwareWithTerminalIds]) {
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
  }
  expect(explicitlyOriginal.mergedHdRoutes).toEqual(original.mergedHdRoutes)
  expect(layerAware.mergedHdRoutes).toHaveLength(1)
  const merged = layerAware.mergedHdRoutes[0]!
  expect(merged.route[0]!.z).toBe(0)
  expect(merged.route.at(-1)!.z).toBe(1)
  expect(layerAwareWithTerminalIds.mergedHdRoutes[0]!.route).toEqual(merged.route)
  expect(layerAwareWithTerminalIds.mergedHdRoutes[0]!.startPcbPortId).toBe("top-port")
  expect(layerAwareWithTerminalIds.mergedHdRoutes[0]!.endPcbPortId).toBe("bottom-port")
  expect(merged.vias).toEqual([{ x: 0, y: 0 }])
  const coverage = evaluateConnectionCoverage(srj,
    convertToCircuitJson(srj, layerAware.mergedHdRoutes, {
      originalSrj: srj, includeOriginalConnections: true,
    }),
  )
  expect(coverage.summary.requiredPairCount).toBe(1)
  expect(coverage.summary.coveredNetCount).toBe(1)
  expect(coverage.summary.errorCount).toBe(0)
})
