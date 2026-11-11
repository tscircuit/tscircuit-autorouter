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
  expect(solver.capacityNodes).toHaveLength(125_920)
  expect(solver.capacityEdges).toHaveLength(347_143)
  expect(
    createHash("sha256")
      .update(JSON.stringify(solver.capacityEdges))
      .digest("hex"),
  ).toBe("88c4a60dd836a9b8f7adb388f6e72379db6dbd3469d128f9cd89e0038dc3ff4b")
  await expect(
    getA64EdgeLookupSvg({
      nodes: solver.capacityNodes!,
      edges: solver.capacityEdges!,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
})
