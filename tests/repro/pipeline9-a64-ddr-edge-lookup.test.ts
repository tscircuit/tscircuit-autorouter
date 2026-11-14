import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { getA64EdgeLookupSvg } from "tests/fixtures/getA64EdgeLookupSvg"

test("A64 DDR keeps its complete ordered capacity graph", async (): Promise<void> => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "../fixtures/assets/a64-ddr-edge-lookup/input.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  while (!solver.failed && !solver.solved && !solver.edgeSolver?.solved) {
    solver.step()
  }
  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.edgeSolver?.solved).toBe(true)
  expect(input.connections).toHaveLength(43)
  expect(solver.capacityNodes).toHaveLength(111_539)
  expect(solver.capacityEdges).toHaveLength(315_436)
  expect(
    createHash("sha256")
      .update(JSON.stringify(solver.capacityEdges))
      .digest("hex"),
  ).toBe("be306d4a7a8591dac64eaba39c7e86e223c6510022e9cee4ff66ae1b1c6d3b50")
  await expect(
    getA64EdgeLookupSvg({
      nodes: solver.capacityNodes!,
      edges: solver.capacityEdges!,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
})
