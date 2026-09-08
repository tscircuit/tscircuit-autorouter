import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import type { CapacityMeshNode } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("fixed copper limits port access by physical width, layer, and canonical net", () => {
  const connectivityMap = new ConnectivityMap({})
  connectivityMap.addConnections([["fixed", "fixed-alias"], ["other"]])
  const fixedNetId = connectivityMap.getNetConnectedToId("fixed")!
  const otherNetId = connectivityMap.getNetConnectedToId("other")!
  for (const offset of [0, 17.31]) {
    const nodes: CapacityMeshNode[] = [-1, 1].map((x) => ({
      capacityMeshNodeId: `node-${x}`,
      center: { x: x + offset, y: offset },
      width: 2,
      height: 2,
      layer: "top",
      availableZ: [0, 1, 2, 3],
    }))
    const wire: HighDensityRoute = {
      connectionName: "fixed-alias",
      rootConnectionName: fixedNetId,
      traceThickness: 0.1,
      viaDiameter: 0.45,
      route: [
        { x: offset - 0.2, y: offset - 1, z: 0 },
        { x: offset - 0.2, y: offset + 1, z: 0 },
      ],
      vias: [],
    }
    const via: HighDensityRoute = {
      ...wire,
      route: [
        { x: offset - 0.3, y: offset, z: 0 },
        { x: offset - 0.3, y: offset, z: 3 },
      ],
      vias: [{ x: offset - 0.3, y: offset }],
    }
    const getRestriction = (
      routes: HighDensityRoute[],
      z: number,
      clearance = 0.1,
    ): string | null | undefined =>
      buildHyperGraph({
        capacityMeshNodes: nodes,
        connectivityMap,
        simpleRouteJsonConnections: [],
        layerCount: 4,
        fixedCopper: { routes, traceWidth: 0.15, clearance },
        segmentPortPoints: [
          {
            segmentPortPointId: "gate",
            x: offset,
            y: offset,
            availableZ: [z],
            nodeIds: ["node--1", "node-1"],
            edgeId: "edge",
            connectionName: null,
            distToCentermostPortOnZ: 0,
            cramped: false,
          },
        ],
      }).graph.ports[0]!.d.requiredNetId

    // The 0.075 mm edge gap misses the 0.1 mm clearance despite no overlap.
    expect(getRestriction([wire], 0)).toBe(fixedNetId)
    expect(getRestriction([wire], 1)).toBeUndefined()
    expect(getRestriction([wire], 0, 0.05)).toBeUndefined()
    expect(getRestriction([via], 2)).toBe(fixedNetId)
    expect(
      getRestriction([wire, { ...wire, rootConnectionName: otherNetId }], 0),
    ).toBeNull()
    expect(
      getRestriction([wire, { ...wire, connectionName: "same-alias" }], 0),
    ).toBe(fixedNetId)
  }
})
