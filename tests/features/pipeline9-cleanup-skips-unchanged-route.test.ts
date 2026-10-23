import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9EffortCleanupSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9EffortCleanupSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("post-repair cleanup skips full-board scoring for unchanged vertex candidates", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "signal",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0, pcb_port_id: "left" },
        { x: 3, y: 0, z: 0, pcb_port_id: "right" },
      ],
      vias: [],
    },
  ]
  const original = structuredClone(routes)
  let costChecks = 0
  const solver = new Pipeline9EffortCleanupSolver({
    effort: 1,
    config: {
      hdRoutes: routes,
      obstacles: [],
      connMap: new ConnectivityMap({}),
      colorMap: {},
      defaultViaDiameter: 0.3,
      layerCount: 2,
      enableVertexShortcuts: true,
      useTraceWidthAwareClearance: true,
    },
    getCost: (candidate): { vias: number; points: number } => {
      costChecks++
      return {
        vias: candidate.reduce((sum, route) => sum + route.vias.length, 0),
        points: candidate.reduce((sum, route) => sum + route.route.length, 0),
      }
    },
    isValid: (): boolean => true,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.vertexShortcutSolver).toBeDefined()
  expect(solver.getOutput()).toEqual(original)
  expect(routes).toEqual(original)
  // Initial scoring and the existing via-removal pass still run.
  expect(costChecks).toBe(2)
})
