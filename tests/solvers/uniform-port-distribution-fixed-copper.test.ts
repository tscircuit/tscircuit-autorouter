import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  HighDensitySolverB01,
  defaultB01Params,
} from "@tscircuit/high-density-b01"
import { redistributePortPointsAroundFixedCopper } from "lib/solvers/UniformPortDistributionSolver/redistributePortPointsAroundFixedCopper"
import type {
  PortPointWithOwnerPair,
  SharedEdge,
} from "lib/solvers/UniformPortDistributionSolver/types"

test("boundary crossings clear foreign copper without blocking connected aliases or other layers", (): void => {
  const edge: SharedEdge = {
    ownerNodeIds: ["lower", "upper"],
    ownerPairKey: "lower|upper",
    orientation: "horizontal",
    x1: -43.92,
    x2: -43.28,
    y1: 33.82,
    y2: 33.82,
    center: { x: -43.6, y: 33.82 },
    length: 0.64,
    nodeSideByOwnerId: { lower: "top", upper: "bottom" },
  }
  const port: PortPointWithOwnerPair = {
    portPointId: "crossing",
    connectionName: "VBUS",
    rootConnectionName: "VBUS",
    ownerNodeIds: edge.ownerNodeIds,
    ownerPairKey: edge.ownerPairKey,
    x: -43.6,
    y: 33.82,
    z: 0,
  }
  for (const sameNet of [false, true]) {
    for (const z of [0, 1]) {
      const connMap = new ConnectivityMap({})
      connMap.addConnections([["VBUS"], ["GND", "ground_alias"]])
      if (sameNet) connMap.addConnections([["ground_alias", "VBUS"]])
      const fixed = {
        connectionName: "ground_alias",
        rootConnectionName: "GND",
        traceThickness: 0.1,
        viaDiameter: 0.45,
        route: [
          { x: -43.6, y: 31.31, z },
          { x: -43.6, y: 34.21, z },
        ],
        vias: [],
      }
      const [crossing] = redistributePortPointsAroundFixedCopper({
        sharedEdge: edge,
        portPoints: [port],
        originalPortPoints: [{ ...port, x: -43.4675 }],
        constraints: {
          routes: [fixed],
          connMap,
          layerCount: 2,
          traceWidth: 0.1,
          clearance: 0.15,
        },
      })
      if (sameNet || z === 1) {
        expect(crossing).toEqual(port)
      } else {
        expect(crossing!.x).toBeGreaterThan(-43.35)
        expect(crossing!.x).toBeLessThan(-43.28)
        const solver = new HighDensitySolverB01({
          ...defaultB01Params,
          nodeWithPortPoints: {
            capacityMeshNodeId: "corridor",
            center: { x: -43.6, y: 32.7 },
            width: 0.64,
            height: 2.24,
            availableZ: [0],
            portPoints: [{ ...crossing!, x: -43.28, y: 32.3166248 }, crossing!],
          },
          obstacles: [{ ...fixed, type: "route" }],
          traceThickness: 0.1,
          viaDiameter: 0.45,
          obstacleClearanceMargin: 0.15,
        })
        solver.solve()
        expect(solver.error).toBeNull()
        expect(solver.solved).toBeTrue()
      }
    }
  }
  expect(port.x).toBe(-43.6)
})
