import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
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
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  while (
    !pipeline.portPointPathingSolver &&
    !pipeline.failed &&
    !pipeline.solved
  )
    pipeline.step()
  expect(pipeline.failed).toBe(false)
  const params = pipeline.portPointPathingSolver!.getConstructorParams()[0]
  const connections = params.connections.map((connection) => {
    const { simpleRouteConnection } = connection
    if (!simpleRouteConnection) {
      throw new Error(`Missing SRJ connection for ${connection.connectionId}`)
    }
    return { ...connection, simpleRouteConnection }
  })
  const serialized = buildSerializedTinyGraph({
    ...params,
    connections,
    unprunedUnoccupiedSegments: undefined,
  })
  expect(
    serialized.regions.find(
      (region) => region.regionId === "topology_merge_3837",
    )!.d.netId,
  ).toBeDefined()
  const before = JSON.stringify(serialized)
  expect(
    preserveSerializedTerminalConnectivity(serialized, () => {
      throw new Error("Connected H3 must not prepare omitted ports")
    }),
  ).toBe(serialized)
  expect(JSON.stringify(serialized)).toBe(before)
})
