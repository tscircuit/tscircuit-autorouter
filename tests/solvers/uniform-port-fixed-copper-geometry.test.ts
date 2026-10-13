import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { redistributePortPointsAroundFixedCopper } from "lib/solvers/UniformPortDistributionSolver/redistributePortPointsAroundFixedCopper"
import type {
  PortPointWithOwnerPair,
  SharedEdge,
} from "lib/solvers/UniformPortDistributionSolver/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("fixed-copper boundary intervals include diagonal ends and via spans without reserving distant copper", (): void => {
  const connMap = new ConnectivityMap({})
  connMap.addConnections([["signal"], ["foreign"]])
  for (const vertical of [false, true]) {
    const edge: SharedEdge = {
      ownerNodeIds: ["a", "b"],
      ownerPairKey: "a|b",
      orientation: vertical ? "vertical" : "horizontal",
      x1: vertical ? 0 : -2,
      x2: vertical ? 0 : 2,
      y1: vertical ? -2 : 0,
      y2: vertical ? 2 : 0,
      center: { x: 0, y: 0 },
      length: 4,
      nodeSideByOwnerId: {
        a: vertical ? "right" : "top",
        b: vertical ? "left" : "bottom",
      },
    }
    const port: PortPointWithOwnerPair = {
      connectionName: "signal",
      portPointId: "crossing",
      x: 0,
      y: 0,
      z: 0,
      ownerNodeIds: edge.ownerNodeIds,
      ownerPairKey: edge.ownerPairKey,
    }
    const routes: HighDensityRoute[] = [
      {
        connectionName: "foreign",
        traceThickness: 0.1,
        viaDiameter: 0.45,
        route: [
          { x: -0.5, y: -0.5, z: 0 },
          { x: 0, y: 0, z: 0 },
        ],
        vias: [],
      },
      {
        connectionName: "foreign",
        traceThickness: 0.1,
        viaDiameter: 0.45,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 1 },
        ],
        vias: [{ x: 0, y: 0 }],
      },
      {
        connectionName: "foreign",
        traceThickness: 0.1,
        viaDiameter: 0.45,
        route: [
          { x: 10, y: 10, z: 0 },
          { x: 10, y: 11, z: 0 },
        ],
        vias: [],
      },
    ]
    for (const fixed of routes) {
      const [crossing] = redistributePortPointsAroundFixedCopper({
        sharedEdge: edge,
        portPoints: [port],
        originalPortPoints: [port],
        constraints: {
          routes: [fixed],
          connMap,
          layerCount: 2,
          traceWidth: 0.1,
          clearance: 0.15,
        },
      })
      if (fixed.route[0]!.x === 10) {
        expect(crossing).toEqual(port)
      } else {
        const required = fixed.vias.length ? 0.425 : 0.25
        expect(
          pointToSegmentDistance(crossing!, fixed.route[0]!, fixed.route[1]!),
        ).toBeGreaterThan(required)
      }
      expect(vertical ? crossing!.x : crossing!.y).toBe(0)
    }
  }
})
