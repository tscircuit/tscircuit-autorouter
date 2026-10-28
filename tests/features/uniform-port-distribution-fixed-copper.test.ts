import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"

test("redistribution reserves immutable copper by actual width, layer, and canonical owner", () => {
  const ports = [
    { portPointId: "foreign-top", connectionName: "foreign", x: 0, y: 1, z: 0 },
    { portPointId: "foreign-bottom", connectionName: "foreign", x: 0, y: 1, z: 1 },
    { portPointId: "same-net", connectionName: "forest-alias", x: 0, y: 1, z: 2 },
  ]
  const nodes: NodeWithPortPoints[] = [-1, 1].map((x, index) => ({
    capacityMeshNodeId: index === 0 ? "left" : "right",
    center: { x, y: 0 }, width: 2, height: 4, availableZ: [0, 1, 2],
    portPoints: structuredClone(ports),
  }))
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({
    ...node,
    availableZ: [0, 1, 2],
    portPoints: ports.map((port) => ({ ...port, connectionNodeIds: ["left", "right"], distToCentermostPortOnZ: 0 })),
  }))
  const fixedRoutes: HighDensityRoute[] = [0, 2].map((z) => ({
    connectionName: `forest-fixed-${z}`, rootConnectionName: "forest-root",
    traceThickness: 0.4, viaDiameter: 0.6, vias: [],
    route: [{ x: -1, y: -1.0000000225886806, z }, { x: 1, y: 0.9999999774113194, z }],
  }))
  const originalRoutes = structuredClone(fixedRoutes)
  const solver = new UniformPortDistributionSolver({
    nodeWithPortPoints: nodes, inputNodesWithPortPoints: inputNodes,
    useLayerAwareGeometry: true, layerCount: 4, obstacles: [],
    fixedCopper: {
      routes: fixedRoutes,
      netByConnectionName: new Map([["forest-root", "canonical-forest"], ["forest-alias", "canonical-forest"], ["foreign", "canonical-foreign"]]),
      traceWidthByConnectionName: new Map([["foreign", 0.2], ["forest-alias", 0.2]]),
      clearance: 0.15,
    },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  for (const node of solver.getOutput()) {
    const [foreignTop, foreignBottom, sameNet] = node.portPoints
    expect(pointToSegmentDistance(foreignTop!, fixedRoutes[0]!.route[0]!, fixedRoutes[0]!.route[1]!)).toBeCloseTo(0.45, 12)
    expect(foreignTop!.y).not.toBe(0)
    expect(foreignBottom).toMatchObject({ x: 0, y: 0, z: 1 })
    expect(sameNet).toMatchObject({ x: 0, y: 0, z: 2 })
  }
  expect(fixedRoutes).toEqual(originalRoutes)
  expect(nodes[0]!.portPoints).toEqual(ports)
})
