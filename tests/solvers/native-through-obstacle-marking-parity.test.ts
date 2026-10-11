import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import { PhysicalTraceSimplificationSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/PhysicalTraceSimplificationSolver"
import { markNativeThroughObstacleSegments } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/markNativeThroughObstacleSegments"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"

type Config = ConstructorParameters<typeof TraceSimplificationSolver>[0]

function createConfig(coordinate: number, layers: number[], metadata: unknown): Config {
  const routes: HighDensityRoute[] = [{ connectionName: "route", rootConnectionName: "root", traceThickness: 0.15,
    viaDiameter: 0.3, route: [{ x: coordinate, y: -0, z: 0, toNextSegmentType: "through_obstacle",
      toNextSegmentCircuitJsonMetadata: { pcb_plated_hole_id: "obsolete" } }, { x: coordinate, y: -0, z: 1 },
      { x: 2, y: 0, z: 1 }], vias: [{ x: coordinate, y: -0 }, { x: 2, y: 0 }] }]
  const obstacles: Obstacle[] = [{ type: "rect", center: { x: 0, y: 0 }, width: 0.2, height: 0.2, layers: ["top", "bottom"],
    __zLayers: layers, connectedTo: ["pad"], circuitJsonMetadata: metadata as any },
    { type: "rect", center: { x: 0, y: 0 }, width: 0.3, height: 0.3, layers: ["top", "bottom"],
      __zLayers: [0, 1], connectedTo: ["root"], circuitJsonMetadata: { second: true } as any }]
  return { hdRoutes: routes, obstacles, connMap: new ConnectivityMap({ net: ["route", "root", "pad"] }),
    colorMap: {}, defaultViaDiameter: 0.3, layerCount: 2 }
}

test("native marking prefilters ordered same-net contacts per call and preserves geometry, metadata, mutations and early errors", (): void => {
  for (const coordinate of [-0, 0, 0.1 + 1e-6, 0.1 + 1e-6 + Number.EPSILON, -0.1 - 1e-6, 2]) {
    for (const layers of [[], [0], [0, 1]]) {
      for (const metadata of [undefined, null, { pcb_plated_hole_id: "first" }]) {
        const config = createConfig(coordinate, layers, metadata)
        const native = new TraceSimplificationSolver(config)
        const parallel = new PhysicalTraceSimplificationSolver(config)
        expect(parallel.simplifiedHdRoutes).toEqual(native.simplifiedHdRoutes)
        const normalized = (native as unknown as { simplificationConfig: Config }).simplificationConfig
        const output = markNativeThroughObstacleSegments({ routes: config.hdRoutes, obstacles: normalized.obstacles,
          connMap: normalized.connMap })
        const expected = native.markThroughObstacleSegments(config.hdRoutes)
        expect(output).toEqual(expected)
        expect(output[0]!.route[0]!.toNextSegmentCircuitJsonMetadata)
          .toBe(expected[0]!.route[0]!.toNextSegmentCircuitJsonMetadata)
        expect(Object.is(output[0]!.route[0]!.x, coordinate)).toBe(true)
        expect(Object.is(output[0]!.route[0]!.y, -0)).toBe(true)
        expect(output[0]!.vias.every((via) => config.hdRoutes[0]!.vias.includes(via))).toBe(true)
        expect(config.hdRoutes[0]!.route[0]!.toNextSegmentCircuitJsonMetadata)
          .toEqual({ pcb_plated_hole_id: "obsolete" })
      }
    }
  }
  const config = { ...createConfig(0, [0, 1], { original: true }),
    connMap: new ConnectivityMap({ root: ["route", "root"], isolated: ["pad"] }) }
  const native = new TraceSimplificationSolver(config)
  const normalized = (native as unknown as { simplificationConfig: Config }).simplificationConfig
  for (let iteration = 0; iteration < 4; iteration++) {
    if (iteration === 1) config.connMap.addConnections([["route", "pad"]])
    if (iteration === 2) normalized.obstacles[0]!.center.x = 3
    if (iteration === 3) {
      normalized.obstacles[1]!.connectedTo = ["unconnected"]
      normalized.obstacles[0]!.circuitJsonMetadata = { updated: true } as any
      normalized.obstacles[0]!.center.x = 0
    }
    expect(markNativeThroughObstacleSegments({ routes: config.hdRoutes, obstacles: normalized.obstacles,
      connMap: config.connMap })).toEqual(native.markThroughObstacleSegments(config.hdRoutes))
  }
  const earlyConfig = createConfig(0, [0, 1], { first: true })
  const earlyNative = new TraceSimplificationSolver(earlyConfig)
  const earlyNormalized = (earlyNative as unknown as { simplificationConfig: Config }).simplificationConfig
  const error = new Error("later obstacle eligibility failed")
  Object.defineProperty(earlyNormalized.obstacles[1], "connectedTo", { get: (): never => { throw error } })
  const covered = [{ ...earlyConfig.hdRoutes[0]!, route: earlyConfig.hdRoutes[0]!.route.slice(0, 2),
    vias: earlyConfig.hdRoutes[0]!.vias.slice(0, 1) }]
  expect(markNativeThroughObstacleSegments({ routes: covered, obstacles: earlyNormalized.obstacles,
    connMap: earlyConfig.connMap })).toEqual(earlyNative.markThroughObstacleSegments(covered))
  const uncovered = [{ ...covered[0]!, vias: [{ x: 4, y: 4 }] }]
  for (const mark of [(): unknown => earlyNative.markThroughObstacleSegments(uncovered),
    (): unknown => markNativeThroughObstacleSegments({ routes: uncovered, obstacles: earlyNormalized.obstacles,
      connMap: earlyConfig.connMap })]) {
    let thrown: unknown
    try { mark() } catch (caught) { thrown = caught }
    expect(thrown).toBe(error)
  }
  const repeated = createConfig(0, [0, 1], { repeated: true })
  repeated.hdRoutes[0]!.vias = Array.from({ length: 20 }, (): { x: number; y: number } => ({ x: 4, y: 4 }))
  const repeatedNative = new TraceSimplificationSolver(repeated)
  const repeatedNormalized = (repeatedNative as unknown as { simplificationConfig: Config }).simplificationConfig
  const areIdsConnected = repeated.connMap.areIdsConnected.bind(repeated.connMap)
  let calls = 0
  repeated.connMap.areIdsConnected = (a: string, b: string): boolean => {
    calls++
    return areIdsConnected(a, b)
  }
  const repeatedExpected = repeatedNative.markThroughObstacleSegments(repeated.hdRoutes)
  const nativeCalls = calls
  calls = 0
  expect(markNativeThroughObstacleSegments({ routes: repeated.hdRoutes,
    obstacles: repeatedNormalized.obstacles, connMap: repeated.connMap })).toEqual(repeatedExpected)
  expect(calls).toBe(1)
  expect(nativeCalls).toBe(21)
})
