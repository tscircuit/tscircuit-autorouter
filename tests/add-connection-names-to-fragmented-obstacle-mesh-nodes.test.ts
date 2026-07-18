import { expect, test } from "bun:test"
import { addConnectionNamesToFragmentedObstacleMeshNodes } from "lib/solvers/TopologyPlanningSolver/add-connection-names-to-fragmented-obstacle-mesh-nodes"
import type {
  CapacityMeshNode,
  Obstacle,
  SimpleRouteConnection,
} from "lib/types"

test("adds route names only to mesh nodes containing connected obstacle fragments", (): void => {
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

  const result = addConnectionNamesToFragmentedObstacleMeshNodes({
    meshNodes,
    obstacles,
    connections,
    layerCount: 2,
  })

  expect(result[0]?._connectedTo).toEqual(["existing-net", "net-a"])
  expect(result[1]?._connectedTo).toBeUndefined()
  expect(result[2]?._connectedTo).toBeUndefined()
  expect(result[3]?._connectedTo).toBeUndefined()
  expect(result[4]?._connectedTo).toBeUndefined()
  expect(result[5]?._connectedTo).toBeUndefined()
  expect(meshNodes[0]?._connectedTo).toEqual(["existing-net"])
})
