import { expect, test } from "bun:test"
import inputJson from "../../../fixtures/bug-reports/rvboy-escape-via-span/rvboy-native.srj.json"
import { getRvboyPourPairingView } from "../../../fixtures/bug-reports/rvboy-escape-via-span/getRvboyPourPairingView"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../../../lib/types"

test("RVboy escape vias share the complete tiled ground plane", async (): Promise<void> => {
  const input = structuredClone(inputJson) as SimpleRouteJson
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  while (!pipeline.netToPointPairsSolver?.solved && !pipeline.failed) {
    pipeline.step()
  }
  expect(pipeline.failed).toBe(false)
  const escape = pipeline.escapeViaLocationSolver!
  expect(escape.createdEscapeVias).toHaveLength(197)
  const viaIds = escape.createdEscapeVias.map((via) => via.pointId).sort()
  const groups = escape
    .getOutputSimpleRouteJson()
    .connections.flatMap(
      (connection) => connection.externallyConnectedPointIds ?? [],
    )
  expect(
    groups.some(
      (group) => JSON.stringify([...group].sort()) === JSON.stringify(viaIds),
    ),
  ).toBe(true)
  const paired = pipeline.srjWithPointPairs!
  const ground = paired.connections.filter((connection) =>
    connection.name.includes("source_net_0"),
  )
  expect(ground).toHaveLength(213)
  expect(
    ground.filter((connection) =>
      connection.pointsToConnect.every((point) =>
        point.pointId?.startsWith("escape-via:"),
      ),
    ),
  ).toHaveLength(0)
  await expect(
    getRvboyPourPairingView(input, paired, {
      minX: -73.25,
      maxX: 73.25,
      minY: -43.95,
      maxY: 43.95,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
  await expect(
    getRvboyPourPairingView(input, paired, {
      minX: -22,
      maxX: 8,
      minY: -8,
      maxY: 10,
    }),
  ).toMatchSvgSnapshot(import.meta.path.replace(".test.ts", "-detail.test.ts"))
})
