import { expect, test } from "bun:test"
import { createPipeline9FixedPadClearance } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9FixedPadClearance"
import { resolvePipeline9PadAreaTerminals } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/resolvePipeline9PadAreaTerminals"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createPipeline9PadAreaTerminalInput } from "./fixtures/createPipeline9PadAreaTerminalInput"

test("pad-area landings preserve declared net partitions across rounded coordinate identities", (): void => {
  for (const layer of ["top", "bottom"]) {
    const originalSrj = createPipeline9PadAreaTerminalInput()
    originalSrj.connections.push({
      name: "foreign-logical-net",
      pointsToConnect: [
        {
          x: 0.634,
          y: 0.001,
          layer,
          pcb_port_id: "foreign-logical-pcb",
          pointId: "foreign-logical-point",
        },
      ],
    })
    const routingSrj = structuredClone(originalSrj)
    // Canonical net numbering belongs to each map; reversing declaration order
    // must not make original-map numbers masquerade as routing-map identities.
    routingSrj.connections.reverse()
    const originalBefore = structuredClone(originalSrj)
    const routingBefore = structuredClone(routingSrj)
    const beforeMap = getConnectivityMapFromSimpleRouteJson(routingSrj)
    expect(beforeMap.getNetConnectedToId("pcb-a")).toBeDefined()
    expect(beforeMap.getNetConnectedToId("foreign-logical-pcb")).toBeDefined()
    expect(beforeMap.getNetConnectedToId("pcb-a")).not.toBe(
      beforeMap.getNetConnectedToId("foreign-logical-pcb"),
    )
    const result = resolvePipeline9PadAreaTerminals({ originalSrj, routingSrj })
    const connection = result.connections.find(
      (candidate): boolean => candidate.name === "net-a",
    )
    if (!connection) throw new Error("Coordinate fixture lost its declared net")
    const landing = connection.pointsToConnect[0]!
    const landingKey = `${Math.round(landing.x * 100)},${Math.round(landing.y * 100)}:0`
    if (layer === "top") {
      expect(landingKey).not.toBe("63,0:0")
      expect(landing.x).not.toBe(0.875)
    } else {
      expect(landing.x).toBeCloseTo(0.63, 12)
      expect(landing.y).toBe(0)
      expect(landingKey).toBe("63,0:0")
    }
    const afterMap = getConnectivityMapFromSimpleRouteJson(result)
    expect(afterMap.getNetConnectedToId("pcb-a")).not.toBe(
      afterMap.getNetConnectedToId("foreign-logical-pcb"),
    )
    expect(afterMap.getNetConnectedToId("pcb-a")).toBe(
      afterMap.getNetConnectedToId("logical-a"),
    )
    expect(result.obstacles).toBe(routingSrj.obstacles)
    expect(originalSrj).toEqual(originalBefore)
    expect(routingSrj).toEqual(routingBefore)
  }

  for (const variant of [
    "coordinate-only-bridge",
    "literal-identifier-bridge",
    "direct-declaration-bridge",
  ] as const) {
    const originalSrj = createPipeline9PadAreaTerminalInput()
    if (variant === "literal-identifier-bridge") {
      originalSrj.connections.push({
        name: "88,0:0",
        pointsToConnect: [
          {
            x: 3,
            y: 2,
            layer: "top",
            pcb_port_id: "bridge-pcb",
            pointId: "bridge-point",
          },
        ],
      })
    } else {
      const bridge = {
        x: 0.876,
        y: 0.001,
        layer: "top",
        pcb_port_id: "bridge-pcb",
        pointId: "bridge-point",
      }
      if (variant === "direct-declaration-bridge") {
        originalSrj.connections[0]!.pointsToConnect.push(bridge)
      } else {
        originalSrj.connections.push({
          name: "coordinate-only-net",
          pointsToConnect: [bridge],
        })
      }
    }
    const routingSrj = structuredClone(originalSrj)
    const beforeMap = getConnectivityMapFromSimpleRouteJson(routingSrj)
    expect(beforeMap.getNetConnectedToId("bridge-pcb")).toBeDefined()
    expect(beforeMap.getNetConnectedToId("pcb-a")).toBe(
      beforeMap.getNetConnectedToId("bridge-pcb"),
    )
    const result = resolvePipeline9PadAreaTerminals({ originalSrj, routingSrj })
    if (variant === "direct-declaration-bridge") {
      expect(result).not.toBe(routingSrj)
      expect(result.connections[0]!.pointsToConnect[0]!.x).toBeCloseTo(0.63, 12)
      expect(result.connections[0]!.pointsToConnect[2]).toBe(
        routingSrj.connections[0]!.pointsToConnect[2],
      )
    } else {
      // No new electrical alias is added to repair a coordinate-only bridge.
      expect(result).toBe(routingSrj)
    }
    const afterMap = getConnectivityMapFromSimpleRouteJson(result)
    expect(afterMap.getNetConnectedToId("pcb-a")).toBe(
      afterMap.getNetConnectedToId("bridge-pcb"),
    )
  }

  // Physical copper can be smaller than the connectivity map's 0.01mm key.
  // These disjoint pads have a 0.001mm gap and width-0.0002 copper, so two
  // individually legal landings can share a previously unused rounded key.
  const originalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.0002,
    minTraceToPadEdgeClearance: 0,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [
      {
        obstacleId: "small-own-a",
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.019,
        height: 0.8,
        layers: ["top"],
        connectedTo: ["moving-a"],
      },
      {
        obstacleId: "small-own-b",
        type: "rect",
        center: { x: 0.02, y: 0 },
        width: 0.019,
        height: 0.8,
        layers: ["top"],
        connectedTo: ["moving-b"],
      },
      {
        obstacleId: "left-barrier",
        type: "rect",
        center: { x: -0.01, y: 0 },
        width: 0.032,
        height: 1.6,
        layers: ["top"],
        connectedTo: ["fixed-barrier-net"],
      },
      {
        obstacleId: "right-barrier",
        type: "rect",
        center: { x: 0.03, y: 0 },
        width: 0.032,
        height: 1.6,
        layers: ["top"],
        connectedTo: ["fixed-barrier-net"],
      },
    ],
    connections: [
      {
        name: "small-net-a",
        pointsToConnect: [
          {
            x: 0.004,
            y: 0,
            layer: "top",
            pcb_port_id: "moving-a",
            pointId: "small-logical-a",
          },
          { x: -0.04, y: 1.5, layer: "top", pointId: "small-a-out" },
        ],
      },
      {
        name: "small-net-b",
        pointsToConnect: [
          {
            x: 0.016,
            y: 0,
            layer: "top",
            pcb_port_id: "moving-b",
            pointId: "small-logical-b",
          },
          { x: 0.04, y: -1.5, layer: "top", pointId: "small-b-out" },
        ],
      },
    ],
  }
  for (const connection of originalSrj.connections) {
    const individual = { ...originalSrj, connections: [connection] }
    const result = resolvePipeline9PadAreaTerminals({
      originalSrj: individual,
      routingSrj: structuredClone(individual),
    })
    const landing = result.connections[0]!.pointsToConnect[0]!
    expect(
      `${Math.round(landing.x * 100)},${Math.round(landing.y * 100)}:0`,
    ).toBe("1,0:0")
  }
  const originalBefore = structuredClone(originalSrj)
  const routingSrj = structuredClone(originalSrj)
  const routingBefore = structuredClone(routingSrj)
  const beforeMap = getConnectivityMapFromSimpleRouteJson(routingSrj)
  expect(beforeMap.getNetConnectedToId("moving-a")).not.toBe(
    beforeMap.getNetConnectedToId("moving-b"),
  )
  expect(beforeMap.getNetConnectedToId("1,0:0")).toBeUndefined()
  const result = resolvePipeline9PadAreaTerminals({ originalSrj, routingSrj })
  const landingKeys = result.connections.map(({ pointsToConnect }): string => {
    const point = pointsToConnect[0]!
    return `${Math.round(point.x * 100)},${Math.round(point.y * 100)}:0`
  })
  expect(landingKeys[0]).toBe("1,0:0")
  expect(landingKeys[1]).not.toBe(landingKeys[0])
  const firstLanding = result.connections[0]!.pointsToConnect[0]!
  const secondLanding = result.connections[1]!.pointsToConnect[0]!
  expect(
    Math.hypot(
      firstLanding.x - secondLanding.x,
      firstLanding.y - secondLanding.y,
    ) - originalSrj.minTraceWidth,
  ).toBeGreaterThan(0.1)
  const clearance = createPipeline9FixedPadClearance({
    obstacles: originalSrj.obstacles,
    connMap: beforeMap,
    layerCount: 2,
    traceToPadClearance: 0,
    viaToPadClearance: 0,
  })
  for (const connection of result.connections) {
    const point = connection.pointsToConnect[0]!
    const canonicalNetId = beforeMap.getNetConnectedToId(connection.name)
    if (!canonicalNetId) throw new Error("Small-pad fixture requires its net")
    expect(
      clearance.traceClearanceIndex.isPointClear({
        point: { x: point.x, y: point.y, z: 0 },
        canonicalNetId,
        copperDiameter: originalSrj.minTraceWidth,
      }),
    ).toBeTrue()
  }
  const afterMap = getConnectivityMapFromSimpleRouteJson(result)
  expect(afterMap.getNetConnectedToId("moving-a")).not.toBe(
    afterMap.getNetConnectedToId("moving-b"),
  )
  for (const id of ["moving-a", "moving-b"]) {
    expect(afterMap.getNetConnectedToId(id)).not.toBe(
      afterMap.getNetConnectedToId("fixed-barrier-net"),
    )
  }
  expect(originalSrj).toEqual(originalBefore)
  expect(routingSrj).toEqual(routingBefore)
})
