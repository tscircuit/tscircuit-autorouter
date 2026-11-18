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

test("a 45 degree pad leaves the node's corners for a via, the same pad unrotated does not", (): void => {
  // A 0.424 mm square reaches 0.3 mm along each axis once rotated 45 degrees,
  // so the via center (0.35, 0.35) is 0.283 mm from it; unrotated, 0.195 mm.
  const pad: Obstacle = {
    type: "rect",
    layers: ["top"],
    center: { x: 0, y: 0 },
    width: 0.3 * Math.SQRT2,
    height: 0.3 * Math.SQRT2,
    connectedTo: [],
  }
  expect(getMarks([{ ...pad, ccwRotationDegrees: 45 }])).toEqual([false])
  expect(getMarks([pad])).toEqual([true])
})
