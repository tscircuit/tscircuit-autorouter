import { expect, test } from "bun:test"
import { createInitialRepairConnectivityMaps, type InitialRepairConnectivityStats } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createInitialRepairConnectivityMaps"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createPreparedRepairCircuitInput } from "../fixtures/initial-repair-connectivity-input"

test("lazy initial graphs preserve native malformed JSON errors before route connectivity access", (): void => {
  for (const fault of ["normalization", "source-graph", "source-generation", "pads", "vias", "route-graph"] as const) {
    const input = createPreparedRepairCircuitInput(0)
    input.originalSrj = structuredClone(input.originalSrj)
    const routes = structuredClone(input.traces)
    // Only PP obstacles reach the later route graph. The original source graph
    // and original pad generator use a distinct obstacle array.
    ;(input.srj.obstacles[0] as any).layers = null
    if (fault === "normalization") (input.srj.connections[0] as any).pointsToConnect = null
    if (fault === "source-graph") (input.originalSrj.obstacles[0] as any).layers = null
    if (fault === "source-generation") routes[0]!.route = []
    if (fault === "pads") input.originalSrj.obstacles.push({ type: "rect", isNonPlatedHole: true,
      obstacleId: "invalid_rotation", center: { x: 20, y: 20 }, width: 1, height: 2,
      layers: ["top", "bottom"], connectedTo: [], ccwRotationDegrees: 13 })
    if (fault === "vias") {
      routes.length = 1
      routes[0]!.connection_name = "missing_connection"
      routes[0]!.connectsTo = []
      ;(routes[0] as any).route = null
    }
    const stats: InitialRepairConnectivityStats = { extraNormalizationCalls: 0, sourceMapBuilds: 0,
      routeMapBuilds: 0, sourceMapReuses: 0, routeMapReuses: 0 }
    const maps = createInitialRepairConnectivityMaps(input.srj, input.originalSrj, stats)
    const params = { inputSrj: input.originalSrj, srjWithPointPairs: input.srj,
      routedTraces: fault === "pads" || fault === "route-graph" ? [] : routes }
    const capture = (reused: boolean): { name: string; message: string } => {
      try {
        evaluateRelaxedDrc({ ...params, ...(reused ? { connectivityMaps: maps } : {}) })
      } catch (error) {
        if (!(error instanceof Error)) throw error
        return { name: error.name, message: error.message }
      }
      throw new Error(`Fault ${fault} did not fail`)
    }
    const native = capture(false)
    expect(capture(true)).toEqual(native)
    expect(stats.routeMapBuilds).toBe(0)
    expect(stats.routeMapReuses).toBe(0)
    expect(stats.sourceMapBuilds).toBe(fault === "normalization" || fault === "source-graph" ? 0 : 1)
    if (fault === "pads") expect(native.message).toContain("invalid_rotation")
    if (fault === "source-generation") expect(native.message).toContain("route_type")
    if (fault === "vias") expect(native.message).toContain("forEach")
  }
})
