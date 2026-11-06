import { expect, spyOn, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("final minimum-width validation covers the net alias and original name", (): void => {
  const input: SimpleRouteJson = {
    bounds: { minX: -5, maxX: 5, minY: -3, maxY: 3 },
    layerCount: 1,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [
      {
        name: "POWER",
        __netConnectionName: "SUPPLY_5V",
        minTraceWidth: 0.4,
        pointsToConnect: [
          { x: -3, y: 0, layer: "top" },
          { x: 3, y: 0, layer: "top" },
        ],
      },
    ],
  }

  for (const connectionName of ["POWER", "SUPPLY_5V"]) {
    for (const width of [0.1, 0.4]) {
      const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
        cacheProvider: null,
      })
      // Complete the real routing stages, stopping just before final validation.
      while (
        !solver.failed &&
        solver.currentPipelineStepIndex < solver.pipelineDef.length
      ) {
        solver.step()
      }
      expect(solver.failed).toBe(false)
      expect(solver.solved).toBe(false)
      expect(solver.srjWithPointPairs!.connections[0]!.__netConnectionName).toBe(
        "SUPPLY_5V",
      )
      const expansion = solver.powerTraceExpansionSolver!
      const output = expansion.getOutput()
      expect(output.length).toBeGreaterThan(0)
      const injectedOutput = output.map((trace) => ({
        ...trace,
        connection_name: connectionName,
        route: trace.route.map((point) =>
          point.route_type === "wire" ? { ...point, width } : point,
        ),
      }))
      // Exercise the guard against a bad downstream result, not a claim that
      // normal routing currently emits under-width copper under this alias.
      const outputSpy = spyOn(expansion, "getOutput").mockReturnValue(
        injectedOutput,
      )
      try {
        solver.step()
        expect(solver.failed).toBe(width < 0.4)
        expect(solver.solved).toBe(width >= 0.4)
        if (width < 0.4) {
          expect(solver.error).toContain(connectionName)
          expect(solver.error).toContain("minimum trace width 0.4mm")
        } else {
          expect(solver.error).toBeNull()
        }
      } finally {
        outputSpy.mockRestore()
      }
    }
  }
})
