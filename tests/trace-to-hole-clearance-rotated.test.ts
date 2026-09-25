import { expect, test } from "bun:test"
import { segmentToBoundsMinDistance } from "@tscircuit/math-utils"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import fixture from "./fixtures/hole-clearance/npth.srj.json"

test("rectangular and rotated hole clearance includes the routed copper width", (): void => {
  for (const Solver of [
    AutoroutingPipelineSolver7_MultiGraph,
    AutoroutingPipelineSolver9_PreloadedTraceGraph,
  ]) {
    for (const angle of [0, 37, 90]) {
      const srj = structuredClone(fixture) as SimpleRouteJson
      srj.minTraceToHoleEdgeClearance = 0.2
      srj.minTraceWidth = 0.4
      srj.connections[0]!.nominalTraceWidth = 0.4
      const hole = srj.obstacles[2]!
      hole.isHole = true
      hole.width = 0.5
      hole.height = 3
      hole.ccwRotationDegrees = angle
      const solver = new Solver(srj, { cacheProvider: null })
      solver.solve()
      expect(solver.error).toBeNull()
      expect(solver.solved).toBe(true)
      const radians = (angle * Math.PI) / 180
      const cos = Math.cos(radians)
      const sin = Math.sin(radians)
      let minimum = Infinity
      for (const trace of solver.getOutputSimplifiedPcbTraces()) {
        for (let index = 1; index < trace.route.length; index++) {
          const a = trace.route[index - 1]!
          const b = trace.route[index]!
          if (
            a.route_type !== "wire" ||
            b.route_type !== "wire" ||
            a.layer !== b.layer
          )
            continue
          expect(a.width).toBeGreaterThanOrEqual(0.4)
          const distance =
            segmentToBoundsMinDistance(
              { x: a.x * cos + a.y * sin, y: -a.x * sin + a.y * cos },
              { x: b.x * cos + b.y * sin, y: -b.x * sin + b.y * cos },
              { minX: -0.25, maxX: 0.25, minY: -1.5, maxY: 1.5 },
            ) -
            Math.max(a.width, b.width) / 2
          minimum = Math.min(minimum, distance)
        }
      }
      expect(Number.isFinite(minimum)).toBe(true)
      expect(minimum).toBeGreaterThanOrEqual(0.2 - 1e-6)
    }
  }
})
