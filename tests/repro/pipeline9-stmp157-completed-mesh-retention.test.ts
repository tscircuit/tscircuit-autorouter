import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { getStmp157CompletedMeshSnapshotSvg } from "tests/fixtures/getStmp157CompletedMeshSnapshotSvg"

test("releases completed STM32MP157 mesh scratch while preserving the real topology", async (): Promise<void> => {
  const rawInput = gunzipSync(
    Uint8Array.from(
      readFileSync(
        new URL(
          "../fixtures/assets/stmp157-remaining-mesh/input.srj.json.gz",
          import.meta.url,
        ),
      ),
    ),
  )
  expect(
    createHash("sha256").update(Uint8Array.from(rawInput)).digest("hex"),
  ).toBe("783738f1ce719d1aa83faa4a5dccd7ba22cc0ed77768b9e081ff9be568e8d7ac")
  const inputSrj: SimpleRouteJson = JSON.parse(rawInput.toString("utf8"))
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    inputSrj,
    { effort: 1, cacheProvider: null },
  )
  while (
    !pipeline.topologyMergingSolver &&
    !pipeline.failed &&
    !pipeline.solved
  ) {
    pipeline.step()
  }
  const merger = pipeline.topologyMergingSolver!
  expect(merger).toBeDefined()
  const originalConstructorInput = JSON.stringify(merger.getConstructorParams())
  while (!merger.solved && !pipeline.failed && !pipeline.solved) {
    pipeline.step()
  }
  expect(pipeline.failed, pipeline.error ?? "").toBe(false)
  expect(merger.solved).toBe(true)
  expect(merger.getOutput()).toHaveLength(115881)
  expect(
    createHash("sha256")
      .update(JSON.stringify(merger.getOutput()))
      .digest("hex"),
  ).toBe("47d8fdefcebe030fe5155b4c2170bbdd23e7d154208f339d4b940b18285867fe")
  expect(JSON.stringify(merger.getConstructorParams())).toBe(
    originalConstructorInput,
  )
  expect(merger.computeProgress()).toBe(1)
  await expect(getStmp157CompletedMeshSnapshotSvg(merger)).toMatchSvgSnapshot(
    import.meta.path,
    { tolerance: 0 },
  )
  expect(merger["atomicRegions"]).toHaveLength(0)
  expect(merger["preparedNodes"]).toHaveLength(0)
  expect(merger["preparedNodeBySourceKey"].size).toBe(0)
  expect(merger["xCoordinates"]).toHaveLength(0)
  expect(merger["horizontalRegionByBucket"].size).toBe(0)
  expect(merger["overruledTargetSourceKeys"].size).toBe(0)
  expect(merger["outputProvenance"].groupIndexesByNodeId.size).toBe(0)
  expect(merger["outputProvenance"].sourceKeysByNodeId.size).toBe(0)
})
