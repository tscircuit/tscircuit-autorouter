import { expect, test } from "bun:test"
import inputJson from "../../fixtures/bug-reports/rvboy-escape-via-span/rvboy-native.srj.json"
import { getRvboyGroundPairingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/getRvboyGroundPairingView"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../../lib/types"

test("RVboy pairs ground terminals with nearby neighbors across KD-tree splits", async (): Promise<void> => {
  const input = structuredClone(inputJson) as SimpleRouteJson
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  while (!pipeline.netToPointPairsSolver?.solved && !pipeline.failed) {
    pipeline.step()
  }
  expect(pipeline.failed).toBe(false)
  const paired = pipeline.srjWithPointPairs!
  const ground = paired.connections.filter((connection) =>
    connection.name.includes("source_net_0"),
  )
  expect(ground).toHaveLength(178)
  const terminalIds = new Set(
    ground.flatMap((connection) =>
      connection.pointsToConnect.map((point) => point.pointId),
    ),
  )
  for (const point of input.connections.find(
    (connection) => connection.name === "source_net_0",
  )!.pointsToConnect) {
    // Terminals already joined by retained ground copper need no extra edge.
    const retained = pipeline.netToPointPairsSolver!.initiallyConnectedMap
    expect(
      terminalIds.has(point.pointId) ||
        [...terminalIds].some((id) =>
          retained.areIdsConnected(point.pointId!, id!),
        ),
    ).toBe(true)
  }
  const distances = ground.map(({ pointsToConnect: [a, b] }) =>
    Math.hypot(a!.x - b!.x, a!.y - b!.y),
  )
  expect(Math.max(...distances)).toBeLessThan(10)
  expect(distances.reduce((sum, distance) => sum + distance, 0)).toBeLessThan(
    435,
  )
  await expect(
    getRvboyGroundPairingView(input, paired, {
      minX: -73.25,
      maxX: 73.25,
      minY: -43.95,
      maxY: 43.95,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
  await expect(
    getRvboyGroundPairingView(input, paired, {
      minX: -18,
      maxX: -2,
      minY: -35.5,
      maxY: -25.9,
    }),
  ).toMatchSvgSnapshot(import.meta.path.replace(".test.ts", "-detail.test.ts"))
})
