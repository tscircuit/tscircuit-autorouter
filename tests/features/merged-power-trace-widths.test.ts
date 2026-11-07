import { expect, test } from "bun:test"
import { PowerTraceExpansionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import { preparePipeline7PowerTraceExpansionInput } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("merged supply routing and expansion retain the widest requirement in either input order", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    bounds: { minX: -5, maxX: 5, minY: -3, maxY: 3 },
    connections: [
      {
        name: "local",
        nominalTraceWidth: 0.4,
        pointsToConnect: [
          { x: -3, y: 0, layer: "top" },
          { x: 0, y: 0, layer: "top" },
        ],
      },
      {
        name: "supply",
        nominalTraceWidth: 0.8,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 3, y: 0, layer: "top" },
        ],
      },
    ],
  }
  for (const connections of [srj.connections, [...srj.connections].reverse()]) {
    const input = { ...srj, connections }
    const pairs = new NetToPointPairsSolver(
      input,
      {},
      getInitiallyConnectedMapFromSimpleRouteJson(input),
    )
    pairs.solve()
    expect(pairs.failed).toBe(false)
    expect(pairs.newConnections).toHaveLength(2)
    expect(
      pairs.newConnections.every(
        (connection) => connection.nominalTraceWidth === 0.8,
      ),
    ).toBe(true)
    const prepared = preparePipeline7PowerTraceExpansionInput({
      originalSrj: input,
      newlyRoutedTraces: [
        {
          type: "pcb_trace",
          pcb_trace_id: "merged_branch",
          connection_name: "local",
          route: [
            { route_type: "wire", x: -3, y: 0, layer: "top", width: 0.1 },
            { route_type: "wire", x: 3, y: 0, layer: "top", width: 0.1 },
          ],
        },
      ],
      expandedConnectionNames: ["local", "supply"],
    })
    const expansion = new PowerTraceExpansionSolver(prepared)
    expansion.solve()
    expect(expansion.failed).toBe(false)
    const output = expansion.getOutput()
    expect(output).toHaveLength(1)
    expect(
      output[0]!.route.every(
        (point) => point.route_type !== "wire" || point.width >= 0.8,
      ),
    ).toBe(true)
    expect(
      connections.find((connection) => connection.name === "local")!
        .nominalTraceWidth,
    ).toBe(0.4)
  }
})
