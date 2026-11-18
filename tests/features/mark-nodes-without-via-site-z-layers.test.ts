import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { markNodesWithoutViaSite } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/markNodesWithoutViaSite"
import type { CapacityMeshNode } from "lib/types/capacity-mesh-types"
import type { Obstacle, SimpleRouteJson } from "lib/types/srj-types"

// A 1 x 1 mm two-layer node at the origin. With a 0.3 mm via and 0.1 mm
// via-to-pad clearance, via centers lie in [-0.35, 0.35] on each axis and must
// stay 0.25 mm from the pad.
const node: CapacityMeshNode = {
  capacityMeshNodeId: "node",
  center: { x: 0, y: 0 },
  width: 1,
  height: 1,
  layer: "top",
  availableZ: [0, 1],
}

const getMarks = (obstacles: Obstacle[], layerCount = 2): boolean[] => {
  const srj: SimpleRouteJson = {
    layerCount,
    minTraceWidth: 0.1,
    obstacles,
    connections: [],
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
  }
  return markNodesWithoutViaSite({
    nodes: [node],
    srj,
    connMap: new ConnectivityMap({}),
    viaDiameter: 0.3,
    viaToPadClearance: 0.1,
  }).map((marked) => marked._lacksViaSite === true)
}

test("canonical __zLayers decide which copper limits a node's vias", (): void => {
  // The same 0.8 mm pad covers every via center of the node. Its canonical
  // layers on a four-layer board are the two the node does not offer.
  const pad: Obstacle = {
    type: "rect",
    layers: ["top"],
    center: { x: 0, y: 0 },
    width: 0.8,
    height: 0.8,
    connectedTo: [],
  }
  expect(getMarks([pad], 4)).toEqual([true])
  expect(getMarks([{ ...pad, __zLayers: [2, 3] }], 4)).toEqual([false])
})
