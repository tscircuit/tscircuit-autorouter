import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("regular node solvers retain only their own pressure factor", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "target-node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: [
      { x: -1, y: 0, z: 0, connectionName: "signal" },
      { x: 1, y: 0, z: 0, connectionName: "signal" },
    ],
  }

  const solver = createPipeline9RegularNodeSolver({
    nodeWithPortPoints: node,
    connMap: new ConnectivityMap({}),
    colorMap: {},
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    nodePfById: new Map([
      ["target-node", 0.25],
      ["unrelated-node", 0.75],
    ]),
  })

  expect([...solver.nodePfById]).toEqual([["target-node", 0.25]])
})
