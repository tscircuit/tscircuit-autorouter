import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { getStmp157MeshComparisonSvg } from "tests/fixtures/getStmp157MeshComparisonSvg"

test("STMP157 retains its native DDR copper with fewer mesh cells and graph edges", async (): Promise<void> => {
  const before: SimpleRouteJson = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "../fixtures/assets/stmp157-remaining-mesh/input.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const native: SimpleRouteJson = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "../fixtures/assets/stmp157-native-ddr-preloads.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  // The native fixture selects DQM0. Restore all 40 remaining connections
  // from the unchanged captured handoff; only the drawing will be cropped.
  const after = { ...native, connections: before.connections }
  const inputs = [before, after]
  const originalInputs = structuredClone(inputs)
  const solvers = inputs.map((input) => {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
      effort: 1,
      cacheProvider: null,
    })
    while (!solver.failed && !solver.solved && !solver.edgeSolver?.solved) {
      solver.step()
    }
    expect(solver.failed, solver.error ?? "").toBeFalse()
    expect(solver.edgeSolver?.solved).toBeTrue()
    return solver
  })
  expect({ ...before, obstacles: after.obstacles, traces: after.traces }).toEqual(
    after,
  )
  expect(before.obstacles).toHaveLength(3449)
  expect(after.obstacles).toHaveLength(710)
  expect(after.traces).toHaveLength(32)
  expect(after.connections).toHaveLength(40)
  expect(before.obstacles.filter((obstacle) => obstacle.componentId)).toEqual(
    after.obstacles,
  )
  expect(solvers[1]!.topologyMergingSolver!.getOutput().length).toBeLessThan(
    solvers[0]!.topologyMergingSolver!.getOutput().length,
  )
  expect(solvers[1]!.capacityEdges!.length).toBeLessThan(
    solvers[0]!.capacityEdges!.length,
  )
  expect(inputs).toEqual(originalInputs)
  await expect(
    getStmp157MeshComparisonSvg({
      before: {
        input: before,
        mergedNodes: solvers[0]!.topologyMergingSolver!.getOutput(),
        capacityNodes: solvers[0]!.capacityNodes!,
        edges: solvers[0]!.capacityEdges!,
      },
      after: {
        input: after,
        mergedNodes: solvers[1]!.topologyMergingSolver!.getOutput(),
        capacityNodes: solvers[1]!.capacityNodes!,
        edges: solvers[1]!.capacityEdges!,
      },
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
