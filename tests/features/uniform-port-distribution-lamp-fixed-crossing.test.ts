import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"

test("the captured lamp crossing cannot recenter a foreign portal onto immutable forest copper", () => {
  const port = {
    portPointId: "ce2129_pp2_z0::0", connectionName: "source_net_22",
    rootConnectionName: "source_net_22", x: -18, y: 7.150041000000001, z: 0,
  }
  const nodes: NodeWithPortPoints[] = [
    { capacityMeshNodeId: "topology_merge_474", center: { x: -17.500001, y: 6.5625205 }, width: 2.2999699999999947, height: 1.1750410000000002, portPoints: [{ ...port }] },
    { capacityMeshNodeId: "cmn_124", center: { x: -18, y: 9.3375205 }, width: 1.2999719999999968, height: 4.374958999999999, portPoints: [{ ...port }] },
  ]
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({
    ...node, availableZ: [0, 1, 2, 3],
    portPoints: [{ ...port, connectionNodeIds: ["topology_merge_474", "cmn_124"], distToCentermostPortOnZ: 0 }],
  }))
  const forest: HighDensityRoute = {
    connectionName: "source_net_18_fixed_3_0", rootConnectionName: "connectivity_net101",
    traceThickness: 0.15, viaDiameter: 0.45, vias: [],
    route: [{ x: -17.175, y: 5.5, z: 0 }, { x: -19.149985, y: 9.44996, z: 0 }],
  }
  const originalForest = structuredClone(forest)
  expect(pointToSegmentDistance(port, forest.route[0]!, forest.route[1]!)).toBeLessThan(0.0001)
  const solver = new UniformPortDistributionSolver({
    nodeWithPortPoints: nodes, inputNodesWithPortPoints: inputNodes,
    useLayerAwareGeometry: true, layerCount: 4, obstacles: [],
    fixedCopper: {
      routes: [forest], clearance: 0.15,
      netByConnectionName: new Map([["connectivity_net101", "forest"], ["source_net_22", "foreign"]]),
      traceWidthByConnectionName: new Map([["source_net_22", 0.15]]),
    },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const output = solver.getOutput().map((node) => node.portPoints[0]!)
  expect(output[0]).toEqual(output[1])
  for (const point of output) {
    expect(pointToSegmentDistance(point, forest.route[0]!, forest.route[1]!)).toBeCloseTo(0.3, 12)
    expect(point.portPointId).toBe(port.portPointId)
    expect(point.connectionName).toBe(port.connectionName)
  }
  expect(forest).toEqual(originalForest)
})
