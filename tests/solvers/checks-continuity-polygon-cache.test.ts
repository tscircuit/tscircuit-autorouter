import { expect, spyOn, test } from "bun:test"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import * as circuitJsonUtil from "@tscircuit/circuit-json-util"
import { Utils } from "@flatten-js/core"
import type { DrcEvaluator } from "high-density-repair03/lib"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type WirePoint = Extract<PcbTrace["route"][number], { route_type: "wire" }>

const wire = (
  x: number,
  y: number,
  width = 0.2,
  layer: WirePoint["layer"] = "top",
): WirePoint => ({ route_type: "wire", x, y, width, layer })

const circuit = (
  routeA: PcbTrace["route"],
  routeB: PcbTrace["route"],
  additions: AnyCircuitElement[] = [],
): AnyCircuitElement[] => {
  const start = routeA[0]
  const end = routeB.at(-1)!
  return [
    { type: "source_trace", source_trace_id: "source_ab", connected_source_port_ids: ["source_a", "source_b"] },
    { type: "pcb_port", pcb_port_id: "pcb_a", source_port_id: "source_a", pcb_component_id: "component_a", x: start.x, y: start.y, layers: ["top"] },
    { type: "pcb_port", pcb_port_id: "pcb_b", source_port_id: "source_b", pcb_component_id: "component_b", x: end.x, y: end.y, layers: ["top"] },
    { type: "pcb_smtpad", pcb_smtpad_id: "pad_a", pcb_port_id: "pcb_a", pcb_component_id: "component_a", shape: "circle", x: start.x, y: start.y, radius: 0.05, layer: "top" },
    { type: "pcb_smtpad", pcb_smtpad_id: "pad_b", pcb_port_id: "pcb_b", pcb_component_id: "component_b", shape: "circle", x: end.x, y: end.y, radius: 0.05, layer: "top" },
    { type: "pcb_trace", pcb_trace_id: "trace_a", source_trace_id: "source_ab", route: routeA },
    { type: "pcb_trace", pcb_trace_id: "trace_b", source_trace_id: "source_ab", route: routeB },
    { type: "pcb_via", pcb_via_id: "via_far", x: -10, y: -10, outer_diameter: 0.3, hole_diameter: 0.1, layers: ["top", "bottom"] },
    ...additions,
  ] as AnyCircuitElement[]
}

test("continuity keeps exact contacts and privately reuses bounded original wire polygons", async () => {
  const polygonBuilder = spyOn(circuitJsonUtil, "getTraceSegmentPolygon")
  const { checkTracesAreContiguous, checkEachPcbPortConnectedToPcbTraces } = await import("@tscircuit/checks")
  const cacheKey = {}
  const originalTolerance = Utils.getTolerance()
  try {
    const input = circuit([wire(0, 0), wire(1, 0)], [wire(1, 0), wire(2, 0)])
    expect(() => checkEachPcbPortConnectedToPcbTraces(structuredClone(input))).not.toThrow()
    const expected = checkTracesAreContiguous(structuredClone(input))
    const before = polygonBuilder.mock.calls.length
    expect(checkTracesAreContiguous(structuredClone(input), { wirePolygonCacheKey: cacheKey })).toEqual(expected)
    expect(polygonBuilder.mock.calls.length - before).toBe(2)
    const populated = polygonBuilder.mock.calls.length
    expect(checkTracesAreContiguous(structuredClone(input), { wirePolygonCacheKey: cacheKey })).toEqual(expected)
    expect(polygonBuilder.mock.calls.length).toBe(populated)

    const traceB = input.find((element) => element.type === "pcb_trace" && element.pcb_trace_id === "trace_b") as PcbTrace
    traceB.route[0].y = 0.201
    traceB.route[1].y = 0.201
    const changedExpected = checkTracesAreContiguous(structuredClone(input))
    const mutatedBefore = polygonBuilder.mock.calls.length
    expect(checkTracesAreContiguous(input, { wirePolygonCacheKey: cacheKey })).toEqual(changedExpected)
    expect(polygonBuilder.mock.calls.length - mutatedBefore).toBe(1)
    expect(changedExpected.some((error) => error.pcb_trace_error_id === "missing_connection_trace_a_pcb_b")).toBe(true)

    const toleranceBefore = polygonBuilder.mock.calls.length
    Utils.setTolerance(originalTolerance / 2)
    const toleranceExpected = checkTracesAreContiguous(structuredClone(input))
    const afterUncachedTolerance = polygonBuilder.mock.calls.length
    expect(checkTracesAreContiguous(structuredClone(input), { wirePolygonCacheKey: cacheKey })).toEqual(toleranceExpected)
    expect(polygonBuilder.mock.calls.length - afterUncachedTolerance).toBe(2)
    expect(afterUncachedTolerance - toleranceBefore).toBe(2)
    Utils.setTolerance(originalTolerance)

    const fixtures: AnyCircuitElement[][] = [
      circuit([wire(0, 0), wire(1, 0)], [wire(1, 0.2), wire(2, 0.2)]),
      circuit([wire(0, 0), wire(1, 0)], [wire(1, 0.2000000001), wire(2, 0.2000000001)]),
      circuit([wire(0, 0, 0), wire(1, 0, 0)], [wire(1, 0, 0), wire(2, 0, 0)]),
      circuit([wire(0, 0), wire(1, 1)], [wire(0, 1), wire(1, 0)]),
      circuit([wire(0, 0), wire(1, 0)], [wire(1, 0, 0.2, "bottom"), wire(2, 0, 0.2, "bottom")]),
      circuit([wire(0, 0), wire(1, 0)], [wire(1.3, 0), wire(2, 0)], [
        { type: "pcb_via", pcb_via_id: "via_bridge", x: 1.15, y: 0, outer_diameter: 0.8, hole_diameter: 0.1, layers: ["top", "bottom"] } as AnyCircuitElement,
      ]),
      circuit([wire(0, 0), wire(1, 0)], [wire(1.3, 0), wire(2, 0)], [
        { type: "pcb_copper_pour", pcb_copper_pour_id: "pour_bridge", layer: "top", shape: "rect", center: { x: 1.15, y: 0 }, width: 0.4, height: 0.4 } as AnyCircuitElement,
      ]),
      // The existing orientation routine classifies these distant main
      // segments as intersecting; the extra disconnected wire admits the
      // pair through the original coarse trace index.
      circuit([
        wire(-1000, 277.08762483671313, 0.1),
        wire(-180.34394562710077, 49.971075547494685, 0.1),
        { route_type: "via", x: 500, y: -400, from_layer: "top", to_layer: "bottom", outer_diameter: 0 } as PcbTrace["route"][number],
        wire(500, -400, 0.1), wire(501, -400, 0.1),
      ], [wire(129.70174718648195, -35.93874906507412, 0.1), wire(1000, -277.08762483671313, 0.1)]),
      circuit([wire(0, 0), wire(1, 0, Infinity)], [wire(1, 0), wire(2, 0)]),
      circuit([wire(0, 0), wire(1, 0)], [wire(1, 0, Number.NaN), wire(2, 0)]),
      circuit([wire(0, 0), wire(1e155, 0)], [wire(0, 1), wire(1e155, 1)]),
      circuit([wire(0, 0), wire(1e-170, 0)], [wire(0, 1), wire(1e-170, 1)]),
      circuit([wire(-0, 0), wire(1, 0)], [wire(1, 0), wire(2, 0)]),
    ]
    for (const fixture of fixtures) {
      let expectedErrors: ReturnType<typeof checkTracesAreContiguous> | undefined
      let expectedException: Error | undefined
      try {
        expectedErrors = checkTracesAreContiguous(structuredClone(fixture))
      } catch (error) {
        if (!(error instanceof Error)) throw error
        expectedException = error
      }
      if (expectedException) {
        expect(() => checkTracesAreContiguous(structuredClone(fixture), { wirePolygonCacheKey: cacheKey })).toThrow(expectedException.message)
      } else {
        expect(checkTracesAreContiguous(structuredClone(fixture), { wirePolygonCacheKey: cacheKey })).toEqual(expectedErrors)
      }
    }
    const cancellationErrors = checkTracesAreContiguous(fixtures[7], { wirePolygonCacheKey: cacheKey })
    expect(cancellationErrors.some((error) => error.pcb_trace_error_id === "missing_connection_trace_a_pcb_b")).toBe(false)

    // Insert 4096 newer wire geometries into this same private cache.
    const fillRoute = Array.from({ length: 4097 }, (_, index) => wire(100 + index, 100))
    const fillInput = circuit(fillRoute, [wire(5000, 100), wire(5001, 100)])
    checkTracesAreContiguous(fillInput, { wirePolygonCacheKey: cacheKey })
    const afterEviction = polygonBuilder.mock.calls.length
    expect(checkTracesAreContiguous(input, { wirePolygonCacheKey: cacheKey })).toEqual(changedExpected)
    expect(polygonBuilder.mock.calls.length - afterEviction).toBe(2)

    // Exercise both real evaluator owners rather than just checker options.
    const { createPipeline9RelaxedDrcEvaluator } = await import("lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9RelaxedDrcEvaluator")
    const { Pipeline9JointDrcRepairSolver } = await import("lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver")
    const { getConnectivityMapFromSimpleRouteJson } = await import("lib/utils/getConnectivityMapFromSimpleRouteJson")
    const routes: HighDensityRoute[] = [
      { connectionName: "layered", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }], vias: [{ x: 0, y: 0 }] },
      { connectionName: "straight", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 2, y: -1, z: 0 }, { x: 2, y: 1, z: 0 }], vias: [] },
    ]
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
      obstacles: [],
      connections: routes.map((route) => ({ name: route.connectionName, pointsToConnect: [route.route[0]!, route.route.at(-1)!].map((point, index) => ({ x: point.x, y: point.y, layer: point.z === 0 ? "top" : "bottom", pointId: `${route.connectionName}_${index}` })) })),
    }
    const connMap = getConnectivityMapFromSimpleRouteJson(srj)
    const evaluator = createPipeline9RelaxedDrcEvaluator({ connections: srj.connections, originalConnections: srj.connections, srjWithPointPairs: srj, originalSrj: srj, mutatedPreloadedTraces: [], layerCount: 2, obstacles: [], defaultViaHoleDiameter: 0.15, connMap })
    const factoryResult = evaluator({ traces: [], routes })
    const firstFactoryBuilds = polygonBuilder.mock.calls.length
    expect(evaluator({ traces: [], routes: structuredClone(routes) })).toEqual(factoryResult)
    expect(polygonBuilder.mock.calls.length).toBe(firstFactoryBuilds)
    const solver = new Pipeline9JointDrcRepairSolver({ srj, srjWithPointPairs: srj, originalSrj: srj, newConnections: srj.connections, newHdRoutes: routes, updatedPreloadedTraces: [], mutatedPreloadedTraceIds: new Set(), connMap, obstacles: [], layerCount: 2, defaultViaDiameter: 0.3, defaultViaHoleDiameter: 0.15, effort: 1, colorMap: {} })
    const reference = (solver as unknown as { cachedReferenceDrcEvaluator: DrcEvaluator }).cachedReferenceDrcEvaluator
    const referenceResult = reference({ traces: [], routes })
    expect(referenceResult).toEqual(factoryResult)
    const changedRoutes = structuredClone(routes)
    for (const point of changedRoutes[1]!.route) point.x = 2.1
    const changedFactoryResult = evaluator({ traces: [], routes: changedRoutes })
    const beforeChangedReference = polygonBuilder.mock.calls.length
    expect(reference({ traces: [], routes: changedRoutes })).toEqual(changedFactoryResult)
    expect(polygonBuilder.mock.calls.length - beforeChangedReference).toBe(1)
  } finally {
    Utils.setTolerance(originalTolerance)
    polygonBuilder.mockRestore()
  }
})
