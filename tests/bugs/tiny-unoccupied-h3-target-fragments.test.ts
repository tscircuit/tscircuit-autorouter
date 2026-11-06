import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { buildSerializedTinyGraph } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { preserveSerializedTerminalConnectivity } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/preserveSerializedTerminalConnectivity"
import type { SimpleRouteJson } from "lib/types"

test("keeps H3 identity after actual target-fragment ownership propagation", (): void => {
  const compressed = readFileSync(
    new URL(
      "../../fixtures/features/h3-ddr-strobes/input.srj.json.gz",
      import.meta.url,
    ),
  )
  const input = JSON.parse(
    gunzipSync(new Uint8Array(compressed)).toString(),
  ) as SimpleRouteJson
  const pipeline = new Pipeline(input, { cacheProvider: null })
  while (
    pipeline.getCurrentPhase() !== "portPointPathingSolver" &&
    !pipeline.failed
  )
    pipeline.step()
  expect(pipeline.failed).toBe(false)
  const step = pipeline.pipelineDef.find(
    (step) => step.solverName === "portPointPathingSolver",
  )!
  const params = step.getConstructorParams(pipeline)[0] as unknown as Parameters<
    typeof buildSerializedTinyGraph
  >[0]
  const serialized = buildSerializedTinyGraph({
    ...params,
    unprunedUnoccupiedSegments: undefined,
  })
  expect(
    serialized.regions.find((region) => region.regionId === "topology_merge_3837")!
      .d.netId,
  ).toBeDefined()
  const before = JSON.stringify(serialized)
  expect(
    preserveSerializedTerminalConnectivity(serialized, () => {
      throw new Error("Connected H3 must not prepare omitted ports")
    }),
  ).toBe(serialized)
  expect(JSON.stringify(serialized)).toBe(before)
})
