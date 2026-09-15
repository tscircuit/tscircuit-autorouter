import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { isPipeline9ObstacleConnectedToRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type { SimpleRouteJson } from "lib/types"

const readExactT113Fixture = (): SimpleRouteJson =>
  JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "../../fixtures/bug-reports/t113-linux-exact-pipeline9-root/t113-linux-exact.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as SimpleRouteJson

test("matches a generated canonical route root to its exact T113 pad", () => {
  const srj = readExactT113Fixture()
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )
  const canonicalNetId = solver.connMap.getNetConnectedToId("source_trace_44")
  if (!canonicalNetId) {
    throw new Error("The exact T113 source_trace_44 has no canonical net")
  }

  expect(canonicalNetId).toBe("connectivity_net57")
  expect(
    solver.connMap.areIdsConnected(canonicalNetId, "source_trace_44"),
  ).toBe(false)

  const t113PowerPad = srj.obstacles.find(
    (obstacle) =>
      obstacle.circuitJsonMetadata?.pcb_smtpad_id === "pcb_smtpad_139",
  )
  if (!t113PowerPad) {
    throw new Error("The exact T113 fixture has no pcb_smtpad_139 obstacle")
  }

  const generatedRoute = {
    connectionName: "source_trace_44_fixed_262_13",
    rootConnectionName: canonicalNetId,
  }
  expect(
    isPipeline9ObstacleConnectedToRoute({
      obstacle: t113PowerPad,
      route: generatedRoute,
      connMap: solver.connMap,
    }),
  ).toBe(true)

  const foreignObstacle = srj.obstacles.find((obstacle) => {
    const obstacleNetIds = obstacle.connectedTo
      .map((id) => solver.connMap.getNetConnectedToId(id))
      .filter((netId): netId is string => netId !== undefined)
    return obstacleNetIds.length > 0 && !obstacleNetIds.includes(canonicalNetId)
  })
  if (!foreignObstacle) {
    throw new Error("The exact T113 fixture has no foreign-net obstacle")
  }
  expect(
    isPipeline9ObstacleConnectedToRoute({
      obstacle: foreignObstacle,
      route: generatedRoute,
      connMap: solver.connMap,
    }),
  ).toBe(false)
})
