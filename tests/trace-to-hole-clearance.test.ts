import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import fixture from "./fixtures/hole-clearance/npth.srj.json"

test("fresh routes respect trace-to-NPTH clearance independently of pad clearance", (): void => {
  let previousRoute = ""
  for (const clearance of [0, 0.2, 0.5]) {
    const srj = structuredClone(fixture) as SimpleRouteJson
    srj.minTraceToHoleEdgeClearance = clearance
    const hole = srj.obstacles.find((o) => o.connectedTo.length === 0)!
    hole.isHole = true
    hole.shape = "circle"
    hole.obstacleId = "switch_mount_hole"
    const before = JSON.stringify(srj)
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
      effort: 1,
      cacheProvider: null,
    })
    expect(solver.originalSrj.obstacles).toMatchObject(srj.obstacles)
    expect(
      solver.srj.obstacles.find((obstacle) => obstacle.isHole)?.width,
    ).toBe(hole.width)
    solver.solve()
    expect(solver.error).toBeNull()
    expect(solver.solved).toBe(true)
    const traces = solver.getOutputSimplifiedPcbTraces()
    let minimum = Infinity
    for (const trace of traces) {
      for (let i = 1; i < trace.route.length; i++) {
        const a = trace.route[i - 1]!
        const b = trace.route[i]!
        if (
          a.route_type !== "wire" ||
          b.route_type !== "wire" ||
          a.layer !== b.layer
        )
          continue
        minimum = Math.min(
          minimum,
          pointToSegmentDistance(hole.center, a, b) -
            hole.width / 2 -
            Math.max(a.width, b.width) / 2,
        )
      }
    }
    expect(traces.length).toBeGreaterThan(0)
    expect(Number.isFinite(minimum)).toBe(true)
    if (clearance === 0) expect(minimum).toBeLessThan(0.2)
    expect(minimum).toBeGreaterThanOrEqual(clearance - 1e-6)
    expect(JSON.stringify(srj)).toBe(before)
    expect(solver.getOutputSimpleRouteJson().obstacles).toMatchObject(
      srj.obstacles,
    )
    const geometry = JSON.stringify(traces)
    if (previousRoute) expect(geometry).not.toBe(previousRoute)
    previousRoute = geometry
    if (clearance === 0.2) {
      const reconstructed = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
        ...solver.getConstructorParams(),
      )
      reconstructed.solve()
      expect(reconstructed.solved).toBe(true)
      expect(reconstructed.getOutputSimplifiedPcbTraces()).toEqual(traces)
    }
  }
})
