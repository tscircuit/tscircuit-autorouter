import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"

test("Pipeline7 reports progress before routing completes", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    {
      layerCount: 2,
      minTraceWidth: 0.15,
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      obstacles: [],
      connections: [
        {
          name: "signal",
          pointsToConnect: [
            { x: 1, y: 2, layer: "top" },
            { x: 9, y: 8, layer: "top" },
          ],
        },
      ],
    },
    { cacheProvider: null },
  )
  expect(solver.progress).toBe(0)
  let previousProgress = 0
  const phasesWithProgress = new Set<string>()

  while (!solver.solved && !solver.failed) {
    solver.step()
    expect(Number.isFinite(solver.progress)).toBe(true)
    expect(solver.progress).toBeGreaterThanOrEqual(previousProgress)
    expect(solver.progress).toBeLessThanOrEqual(1)
    if (solver.progress > 0 && solver.progress < 1) {
      phasesWithProgress.add(solver.getCurrentPhase())
    }
    previousProgress = solver.progress
  }

  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(phasesWithProgress.has("portPointPathingSolver")).toBe(true)
  expect(phasesWithProgress.has("highDensityRouteSolver")).toBe(true)
  expect(solver.progress).toBe(1)
  expect(solver.getOutputSimplifiedPcbTraces()).toHaveLength(1)
})
