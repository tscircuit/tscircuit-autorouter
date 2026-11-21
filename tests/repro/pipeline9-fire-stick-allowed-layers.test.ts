import { beforeAll, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getAllowedLayerSnapshotSvg } from "../fixtures/getAllowedLayerSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

const input: SimpleRouteJson = JSON.parse(
  gunzipSync(
    new Uint8Array(
      readFileSync(
        new URL("./assets/fire-stick-outer-layer-bus.json.gz", import.meta.url),
      ),
    ),
  ).toString(),
)
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
  structuredClone(input),
  { cacheProvider: null },
)
const forbiddenSegments: { layer: string; length: number }[] = []

beforeAll(async (): Promise<void> => {
  expect(input.layerCount).toBe(4)
  expect(input.traces).toHaveLength(0)
  expect(input.connections).toHaveLength(1)
  expect(input.buses).toHaveLength(1)
  const bus = input.buses![0]!
  expect(bus.connectionNames).toContain(input.connections[0]!.name)
  expect(bus.allowedLayers).toEqual(["top", "bottom"])
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces.length).toBeGreaterThan(0)
  for (const trace of traces) {
    for (let index = 1; index < trace.route.length; index++) {
      const start = trace.route[index - 1]!
      const end = trace.route[index]!
      // A through-via spanning an inner layer is not an inner-layer wire.
      if (start.route_type !== "wire" || end.route_type !== "wire") continue
      if (start.layer !== end.layer) continue
      const length = Math.hypot(end.x - start.x, end.y - start.y)
      if (length > 1e-6 && !bus.allowedLayers!.includes(start.layer)) {
        forbiddenSegments.push({ layer: start.layer, length })
      }
    }
  }
  await expect(
    getAllowedLayerSnapshotSvg(
      {
        inputSrj: input,
        srjWithPointPairs: solver.srjWithPointPairs!,
        routedTraces: traces,
      },
      [...new Set(forbiddenSegments.map((segment) => segment.layer))],
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})

test("Pipeline 9 keeps bus wires on their allowed layers", (): void => {
  expect(forbiddenSegments).toEqual([])
})
