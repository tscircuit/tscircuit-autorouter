import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { buildSerializedTinyGraph } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { preserveSerializedTerminalConnectivity } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/preserveSerializedTerminalConnectivity"
import type { SimpleRouteJson } from "lib/types"

function readH3Fixture(filename: string): SimpleRouteJson {
  const compressed = readFileSync(
    new URL(
      `../../fixtures/features/h3-ddr-strobes/${filename}.srj.json.gz`,
      import.meta.url,
    ),
  )
  return JSON.parse(gunzipSync(new Uint8Array(compressed)).toString())
}

test("native copper cannot supply an unoccupied restoration pool", (): void => {
  const input = readH3Fixture("input")
  input.traces = readH3Fixture("routed-data").traces
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
  expect(params.unprunedUnoccupiedSegments).toBeUndefined()
  const connections = params.connections.map((connection) => {
    const { simpleRouteConnection } = connection
    if (!simpleRouteConnection) {
      throw new Error(`Missing SRJ connection for ${connection.connectionId}`)
    }
    return { ...connection, simpleRouteConnection }
  })
  const serialized = buildSerializedTinyGraph({ ...params, connections })
  expect(() =>
    preserveSerializedTerminalConnectivity(serialized, () => []),
  ).toThrow("preloaded assignments")
})
