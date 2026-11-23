import { expect, test } from "bun:test"
import { markViaAreaBesideFixedCopper } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/markViaAreaBesideFixedCopper"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("a node records the share of its via centers that fixed copper and pads leave when it is under a tenth", () => {
  // A fixed wire along x = 0 keeps 0.6 mm via centers 0.1 + 0.3 + 0.15 mm away.
  const srj: SimpleRouteJson = {
    bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 },
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.15,
    obstacles: [],
    connections: [{ name: "signal", pointsToConnect: [] }],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "crystal-wire",
        connection_name: "crystal",
        isFixed: true,
        route: [
          { route_type: "wire", x: 0, y: -5, layer: "bottom", width: 0.2 },
          { route_type: "wire", x: 0, y: 5, layer: "bottom", width: 0.2 },
        ],
      },
    ],
  }
  // Via centers span x = -0.7..0.7; 0.15 mm on each side stays legal (0.21).
  const roomy: CapacityMeshNode = {
    capacityMeshNodeId: "roomy",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    layer: "z0,1",
  }
  // Via centers span x = -0.585..0.585; 0.035 mm on each side stays legal.
  const pocket = { ...roomy, capacityMeshNodeId: "pocket", width: 1.77 }
  // Via centers span x = -0.2..0.2, all inside the wire's keep-out.
  const covered = { ...roomy, capacityMeshNodeId: "covered", width: 1 }
  const clear = {
    ...roomy,
    capacityMeshNodeId: "clear",
    center: { x: 3, y: 0 },
  }
  const narrowerThanVia = {
    ...roomy,
    capacityMeshNodeId: "narrower-than-via",
    width: 0.5,
  }
  const singleLayer = {
    ...roomy,
    capacityMeshNodeId: "single-layer",
    availableZ: [0],
  }
  const nodes = [roomy, pocket, covered, clear, narrowerThanVia, singleLayer]
  const mark = (input: SimpleRouteJson): CapacityMeshNode[] =>
    markViaAreaBesideFixedCopper({
      nodes,
      srj: input,
      connMap: getConnectivityMapFromSimpleRouteJson(input),
      viaDiameter: 0.6,
    })

  const marked = mark(srj)
  expect(marked[0]).toBe(roomy)
  // Sampled on a 0.05 mm grid, so the share is exact to about one cell.
  expect(Math.abs(marked[1]!._viaAreaFraction! - 0.07 / 1.17)).toBeLessThan(
    0.03,
  )
  expect(marked[2]!._viaAreaFraction).toBe(0.01)
  expect(marked.slice(3)).toEqual([clear, narrowerThanVia, singleLayer])

  // Pads flush with the roomy node's sides take the two strips the wire left.
  const withPads: SimpleRouteJson = {
    ...srj,
    obstacles: [-1.5, 1.5].map((x) => ({
      type: "rect",
      layers: ["top"],
      center: { x, y: 0 },
      width: 1,
      height: 4,
      connectedTo: [],
    })),
  }
  expect(mark(withPads)[0]!._viaAreaFraction).toBe(0.01)

  const movable = structuredClone(srj)
  movable.traces![0]!.isFixed = false
  expect(mark(movable)).toBe(nodes)
  expect(mark({ ...srj, allowBlindAndBuriedVias: true })).toBe(nodes)
})
