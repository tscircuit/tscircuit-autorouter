import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { projectPipeline9RegionalHighDensityInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/project-pipeline9-ordinary-high-density-input"
import type { Obstacle } from "lib/types/srj-types"
import { createNetworkedNode } from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 regional projection preserves direct identities and one original net alias without synthesizing obstacleId", () => {
  const node = createNetworkedNode({
    nodeId: "cmn_regional_obstacle_projection",
    connectionName: "route_A",
    rootConnectionName: "root_alias_A",
  })
  const connMap = new ConnectivityMap({
    canonical_net_A: [
      "route_A",
      "root_alias_A",
      "pad_alias_A",
      "obstacle_id_alias_A",
    ],
    foreign_net: ["foreign_A", "foreign_B"],
  })
  const createObstacle = (
    obstacleId: string,
    connectedTo: string[],
    x: number,
  ): Obstacle => ({
    obstacleId,
    type: "rect",
    layers: ["top", "bottom"],
    center: { x, y: 0 },
    width: 0.2,
    height: 0.2,
    connectedTo,
  })
  const projection = projectPipeline9RegionalHighDensityInput({
    nodeWithPortPoints: node,
    connMap,
    obstacles: [
      createObstacle("alias_only", ["pad_alias_A", "foreign_A"], -1),
      createObstacle("exact_connection", ["route_A", "foreign_A"], 0),
      createObstacle("exact_normalized_root", ["canonical_net_A"], 1),
      createObstacle("obstacle_id_alias_A", ["foreign_B"], 1.5),
      createObstacle("far_away", ["route_A"], 100),
    ],
    obstacleMargin: 0.15,
    traceWidth: 0.15,
    viaDiameter: 0.3,
  })

  expect(projection.obstacles.map((obstacle) => obstacle.connectedTo)).toEqual([
    ["pad_alias_A"],
    ["route_A"],
    ["canonical_net_A"],
    [],
  ])
  expect(projection.connectivityNetMap).toEqual({
    canonical_net_A: ["route_A", "root_alias_A", "pad_alias_A"],
  })
})
