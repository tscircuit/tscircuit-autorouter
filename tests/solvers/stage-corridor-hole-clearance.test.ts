import { expect, test } from "bun:test"
import { segmentToBoundsMinDistance, segmentToCircleMinDistance } from "@tscircuit/math-utils"
import { FindClearancePathSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/FindClearancePathSolver"

test("cloned corridor output clears physical non-plated holes on every routing layer", (): void => {
  for (const shape of ["circle", undefined] as const) {
    for (const holeClearance of [0.05, 0.4]) {
      for (const z of [0, 1]) {
        const start = { x: -2, y: 0, z }, end = { x: 2, y: 0, z }
        const bounds = { minX: -3, maxX: 3, minY: -3, maxY: 3 }
        const solver = new FindClearancePathSolver({
          srj: {
            bounds, layerCount: 2, minTraceWidth: 0.2,
            minTraceToPadEdgeClearance: 0.05,
            minTraceToHoleEdgeClearance: holeClearance,
            connections: [],
            obstacles: [{ type: "rect", isNonPlatedHole: true, shape, center: { x: 0, y: 0 }, width: 1, height: 1, layers: ["top", "bottom"], connectedTo: [] }],
          },
          routes: [{ connectionName: "signal", traceThickness: 0.2, viaDiameter: 0.4, route: [start, end], vias: [] }],
          routeIndex: 0, start, end, bounds, traceThickness: 0.2,
          traceClearance: 0.05, viaClearance: 0.1, allowLayerChanges: false, maxNodes: 1000,
        })
        while (!solver.solved && !solver.failed) solver.step()
        expect(solver.failed).toBe(false)
        const path = solver.getOutput()
        expect(path).not.toBeNull()
        expect(path![0]).toEqual(start)
        expect(path!.at(-1)).toEqual(end)
        for (let index = 1; index < path!.length; index++) {
          const a = path![index - 1]!, b = path![index]!
          expect(a.z).toBe(z)
          expect(b.z).toBe(z)
          const physicalDistance = shape === "circle"
            ? segmentToCircleMinDistance(a, b, { x: 0, y: 0, radius: 0.5 })
            : segmentToBoundsMinDistance(a, b, { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 })
          // This assertion measures copper edge to the original hole shape;
          // it does not reuse the search engine's barrier construction.
          expect(physicalDistance - 0.1).toBeGreaterThanOrEqual(holeClearance - 1e-8)
        }
      }
    }
  }
})
