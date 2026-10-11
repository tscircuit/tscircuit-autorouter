import { expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { Resvg } from "@resvg/resvg-js"
import { checkEachPcbTraceNonOverlapping } from "@tscircuit/checks"
import type { CircuitJson, PcbTraceError } from "circuit-json"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { getObstaclesFromSrjTraces } from "lib/utils/convertSrjTracesToObstacles"
import { getCompactViaCopperCircuit } from "tests/fixtures/compactViaCopperCircuit"
import { getCompactViaCopperDiagnosticSvg } from "tests/fixtures/compactViaCopperDiagnostic"

test("compact Core pcbPath preserves retained copper in native routing consumers", async (): Promise<void> => {
  const { circuitJson, srj } = await getCompactViaCopperCircuit()
  const original = structuredClone(srj)
  expect(srj.traces).toHaveLength(1)
  const retained = srj.traces![0]!
  expect(retained.route).toEqual([
    { route_type: "wire", x: 0, y: -2, width: 0.2, layer: "top" },
    { route_type: "via", x: 0, y: 1, from_layer: "top", to_layer: "bottom" },
    { route_type: "wire", x: 2, y: 1, width: 0.2, layer: "bottom" },
  ])
  const obstacles = getObstaclesFromSrjTraces(srj)
  expect(obstacles).toHaveLength(3)
  expect(obstacles[0]!.layers).toEqual(["top", "inner1", "inner2", "bottom"])
  const pipeline9 = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
  const fixedRoutes = convertPreloadedTraceToHdRoutes(retained, 0, srj.layerCount, pipeline9.viaDiameter, pipeline9.connMap)
  expect(fixedRoutes).toHaveLength(3)
  expect(fixedRoutes.map((route) => [route.preloadedRoutePositionStart, route.preloadedRoutePositionEnd])).toEqual([[0, 1], [1, 1], [1, 2]])
  expect(fixedRoutes.map((route) => route.route)).toEqual([
    [{ x: 0, y: -2, z: 0 }, { x: 0, y: 1, z: 0 }],
    [{ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 3 }],
    [{ x: 0, y: 1, z: 3 }, { x: 2, y: 1, z: 3 }],
  ])
  const pipeline4 = new AutoroutingPipelineSolver4(srj)
  pipeline4.solve()
  expect(pipeline4.failed).toBeFalse()
  expect(pipeline4.solved).toBeTrue()
  const traces = pipeline4.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(2)
  for (const connection of srj.connections) {
    const trace = traces.find((trace) => trace.connection_name === connection.name)!
    for (const [index, endpoint] of connection.pointsToConnect.entries()) {
      const copperEndpoint = index === 0 ? trace.route[0]! : trace.route.at(-1)!
      const pad = srj.obstacles.find((obstacle) => obstacle.circuitJsonMetadata?.pcb_port_id === endpoint.pcb_port_id)!
      expect(copperEndpoint.route_type).toBe("wire")
      if (copperEndpoint.route_type !== "wire") throw new Error("Expected pad wire contact")
      expect(copperEndpoint.layer).toBe(endpoint.layer!)
      expect(Math.abs(copperEndpoint.x - pad.center.x)).toBeLessThanOrEqual(pad.width / 2)
      expect(Math.abs(copperEndpoint.y - pad.center.y)).toBeLessThanOrEqual(pad.height / 2)
    }
  }
  const routedCircuitJson = [...circuitJson, ...traces.map((trace) => ({ type: "pcb_trace" as const, pcb_trace_id: trace.pcb_trace_id, source_trace_id: trace.connection_name, route: trace.route }))] as CircuitJson
  const errors = checkEachPcbTraceNonOverlapping(routedCircuitJson, { minClearance: 0.1 }) as PcbTraceError[]
  expect(errors).toEqual([])
  expect(srj).toEqual(original)
  const svg = getCompactViaCopperDiagnosticSvg({ srj, circuitJson, traces, obstacles, errors })
  const snapshot = new URL("./__snapshots__/compact-via-copper.after.svg", import.meta.url)
  if (process.env.UPDATE_COMPACT_VIA_SNAPSHOTS === "1") {
    writeFileSync(snapshot, svg)
    writeFileSync(new URL("./__snapshots__/compact-via-copper.after.png", import.meta.url), new Uint8Array(new Resvg(svg).render().asPng()))
  }
  expect(svg).toBe(readFileSync(snapshot, "utf8"))
})
