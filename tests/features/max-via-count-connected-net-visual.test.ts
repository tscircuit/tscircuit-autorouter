import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import bugreport75ConnectedNet from "../../fixtures/bug-reports/bugreport75-d7c4d8/bugreport75-d7c4d8.srj.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

type MaxViaCountReproConnection = SimpleRouteJson["connections"][number] & {
  maxViaCount?: number
}

test("repro: connected-net route with per-source via limits", (): void => {
  const simpleRouteJson = structuredClone(
    bugreport75ConnectedNet,
  ) as SimpleRouteJson
  const maxViaCountByConnectionName = {
    source_trace_15: 2,
    source_trace_16: 2,
    source_net_0: 3,
    source_net_1: 0,
  }

  for (const [connectionName, maxViaCount] of Object.entries(
    maxViaCountByConnectionName,
  )) {
    const connection = simpleRouteJson.connections.find(
      (candidate) => candidate.name === connectionName,
    ) as MaxViaCountReproConnection | undefined
    if (!connection) {
      throw new Error(`Connected-net fixture is missing ${connectionName}`)
    }
    connection.maxViaCount = maxViaCount
  }

  const solver = new AutoroutingPipelineSolver7_MultiGraph(simpleRouteJson, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
