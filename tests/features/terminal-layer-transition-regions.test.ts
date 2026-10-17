import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { getTargetLayerTransitionPoints } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/getTargetLayerTransitionPoints"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

test("terminal layer transitions are net-owned and materialize a centered via", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -2, y: 0 },
        width: 1,
        height: 1,
        connectedTo: ["net-a"],
      },
      {
        type: "rect",
        layers: ["bottom"],
        center: { x: 2, y: 0 },
        width: 1,
        height: 1,
        connectedTo: ["net-a"],
      },
      {
        type: "rect",
        layers: ["top", "bottom"],
        center: { x: -1.2, y: 0 },
        width: 0.2,
        height: 0.2,
        connectedTo: ["other-net"],
      },
    ],
    connections: [
      {
        name: "net-a",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pcb_port_id: "port-a" },
          { x: 2, y: 0, layer: "bottom", pcb_port_id: "port-b" },
        ],
      },
    ],
  }
  const transitionPoints = getTargetLayerTransitionPoints({
    srj,
    viaDiameter: 0.4,
    obstacleMargin: 0.1,
  })
  expect(transitionPoints).toHaveLength(2)
  expect(transitionPoints).not.toContainEqual({
    x: -1.2,
    y: 0,
    connectionName: "net-a",
  })

  const capacityMeshNodes: CapacityMeshNode[] = [0, 1].map((z) => ({
    capacityMeshNodeId: `node-${z}`,
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    layer: `z${z}`,
    availableZ: [z],
  }))
  const connectivityMap = new ConnectivityMap({})
  connectivityMap.addConnections([["net-a"]])
  const { graph } = buildHyperGraph({
    capacityMeshNodes,
    segmentPortPoints: [],
    layerCount: 2,
    connectivityMap,
    simpleRouteJsonConnections: srj.connections,
    layerTransitionPoints: [transitionPoints[0]!],
    viaDiameter: 0.4,
  })
  const transitionRegion = graph.regions.find(
    (region) => region.regionId === "layer-transition:0",
  )!
  expect(transitionRegion.d.availableZ).toEqual([0, 1])
  expect(transitionRegion.d._connectedTo).toEqual(["net-a"])
  expect(new Set(transitionRegion.ports.map((port) => port.d.z))).toEqual(
    new Set([0, 1]),
  )

  const solver = new HighDensitySolver({
    nodePortPoints: [
      {
        capacityMeshNodeId: transitionRegion.regionId,
        center: transitionRegion.d.center,
        width: transitionRegion.d.width,
        height: transitionRegion.d.height,
        isLayerTransition: true,
        portPoints: [],
        portPointsInPairs: [
          [
            { x: -0.1, y: 0, z: 0, connectionName: "net-a" },
            { x: 0.1, y: 0, z: 1, connectionName: "net-a" },
          ],
        ],
      },
    ],
    viaDiameter: 0.4,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.routes).toHaveLength(1)
  expect(solver.routes[0]!.vias).toEqual([transitionRegion.d.center])
  expect(solver.routes[0]!.route).toEqual([
    { x: -0.1, y: 0, z: 0, pcb_port_id: undefined },
    { ...transitionRegion.d.center, z: 0 },
    { ...transitionRegion.d.center, z: 1 },
    { x: 0.1, y: 0, z: 1, pcb_port_id: undefined },
  ])
  expect(solver.stats.solverNodeCount.LayerTransition).toBe(1)
})
