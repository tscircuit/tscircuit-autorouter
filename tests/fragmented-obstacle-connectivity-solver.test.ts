import { expect, test } from "bun:test"
import {
  FragmentedObstacleConnectivitySolver,
  type FragmentedObstacleConnectivitySolverInput,
} from "lib/solvers/TopologyPlanningSolver/fragmented-obstacle-connectivity-solver"
import type {
  CapacityMeshNode,
  Obstacle,
  SimpleRouteConnection,
} from "lib/types"

test("adds route names only to mesh nodes containing enclosed obstacle fragments", (): void => {
  const meshNodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "fragment-node",
      center: { x: -0.5, y: 0 },
      width: 1,
      height: 1,
      layer: "z1",
      availableZ: [1],
      _containsObstacle: true,
      _connectedTo: ["existing-net"],
    },
    {
      capacityMeshNodeId: "isolated-copy-node",
      center: { x: 3, y: 0 },
      width: 1,
      height: 1,
      layer: "z1",
      availableZ: [1],
      _containsObstacle: true,
    },
    {
      capacityMeshNodeId: "single-obstacle-node",
      center: { x: 6, y: 0 },
      width: 1,
      height: 1,
      layer: "z1",
      availableZ: [1],
      _containsObstacle: true,
    },
    {
      capacityMeshNodeId: "free-node",
      center: { x: -0.5, y: 0 },
      width: 1,
      height: 1,
      layer: "z1",
      availableZ: [1],
    },
    {
      capacityMeshNodeId: "open-fragment-node",
      center: { x: 10.5, y: 0 },
      width: 1,
      height: 1,
      layer: "z1",
      availableZ: [1],
      _containsObstacle: true,
    },
    {
      capacityMeshNodeId: "open-fragment-exit",
      center: { x: 9.5, y: 0 },
      width: 1,
      height: 1,
      layer: "z1",
      availableZ: [1],
    },
  ]
  const obstacles: Obstacle[] = [
    {
      componentId: "fragmented-component",
      type: "rect",
      center: { x: -0.5, y: 0 },
      width: 1,
      height: 1,
      layers: ["bottom"],
      connectedTo: ["pad-a", "net-a"],
    },
    {
      componentId: "fragmented-component",
      type: "rect",
      center: { x: 0.5, y: 0 },
      width: 1,
      height: 1,
      layers: ["bottom"],
      connectedTo: ["pad-a", "net-a"],
    },
    {
      componentId: "fragmented-component",
      type: "rect",
      center: { x: 3, y: 0 },
      width: 1,
      height: 1,
      layers: ["bottom"],
      connectedTo: ["pad-a", "net-a"],
    },
    {
      componentId: "single-component",
      type: "rect",
      center: { x: 6, y: 0 },
      width: 1,
      height: 1,
      layers: ["bottom"],
      connectedTo: ["pad-b", "net-b"],
    },
    {
      componentId: "open-fragment-component",
      type: "rect",
      center: { x: 10.5, y: 0 },
      width: 1,
      height: 1,
      layers: ["bottom"],
      connectedTo: ["pad-c", "net-c"],
    },
    {
      componentId: "open-fragment-component",
      type: "rect",
      center: { x: 11.5, y: 0 },
      width: 1,
      height: 1,
      layers: ["bottom"],
      connectedTo: ["pad-c", "net-c"],
    },
  ]
  const connections: SimpleRouteConnection[] = [
    {
      name: "net-a-mst0",
      __rootConnectionNames: ["net-a"],
      pointsToConnect: [{ x: -0.5, y: 0, layer: "bottom" }],
    },
    {
      name: "net-b",
      pointsToConnect: [{ x: 6, y: 0, layer: "bottom" }],
    },
    {
      name: "net-c",
      pointsToConnect: [{ x: 10.5, y: 0, layer: "bottom" }],
    },
  ]
  const inputProblem: FragmentedObstacleConnectivitySolverInput = {
    meshNodes,
    obstacles,
    connections,
    layerCount: 2,
  }
  const solver = new FragmentedObstacleConnectivitySolver(inputProblem)

  expect(() => solver.getOutput()).toThrow("before the solver completed")
  solver.solve()

  const result = solver.getOutput()
  expect(result[0]?._connectedTo).toEqual(["existing-net", "net-a"])
  expect(result[1]?._connectedTo).toBeUndefined()
  expect(result[2]?._connectedTo).toBeUndefined()
  expect(result[3]?._connectedTo).toBeUndefined()
  expect(result[4]?._connectedTo).toBeUndefined()
  expect(result[5]?._connectedTo).toBeUndefined()
  expect(meshNodes[0]?._connectedTo).toEqual(["existing-net"])
  expect(solver.iterations).toBeGreaterThan(meshNodes.length)
  expect(solver.stats).toMatchObject({
    fragmentGroupCount: 2,
    classifiedFragmentGroupCount: 2,
    groupWithoutRoutingExitCount: 1,
    processedMeshNodeCount: 6,
    updatedMeshNodeCount: 1,
  })
  expect(solver.getConstructorParams()).toEqual([inputProblem])
  expect(solver.visualize().rects?.length).toBeGreaterThan(meshNodes.length)
})
