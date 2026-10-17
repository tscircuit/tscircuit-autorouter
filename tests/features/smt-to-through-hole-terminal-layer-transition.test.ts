import { expect, test } from "bun:test"
import { getTargetLayerTransitionPoints } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/getTargetLayerTransitionPoints"
import type { SimpleRouteJson } from "lib/types"

test("an SMT terminal can escape even when the other terminal is a through-hole", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.15, allowViaInPad: true,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [{
      type: "rect", center: { x: 0, y: 0 }, width: 0.4, height: 0.4,
      layers: ["top"], connectedTo: ["pad-a"],
    }],
    connections: [{
      name: "signal", pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "pad-a" },
        { x: 3, y: 0, layers: ["top", "bottom"], pcb_port_id: "hole-b" },
      ],
    }],
  }
  expect(getTargetLayerTransitionPoints({
    srj, viaDiameter: 0.2, obstacleMargin: 0.1,
  })).toEqual([{ x: 0, y: 0, connectionName: "signal", availableZ: [0, 1] }])
})
