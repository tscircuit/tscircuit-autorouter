import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPortReservationNetIds, type PortReservationContext } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createPortReservationNetIds"
import type { Obstacle } from "lib/types"

test("final native port footprints retain pad owners, layers and exact physical geometry", () => {
  const connMap = new ConnectivityMap({
    registered369: ["source_net_altium_pcb_369", "route369", "pcb_smtpad_altium_8292"],
    registered129: ["source_net_altium_pcb_129", "route129", "pad129"],
    singleTerminal: ["single-terminal-pad"],
  })
  const metadata = [
    { connectionId: "route369", mutuallyConnectedNetworkId: "registered369" },
    { connectionId: "route129", mutuallyConnectedNetworkId: "registered129" },
  ]
  const actualPad: Obstacle = {
    type: "rect", center: { x: 283.25720082, y: 122.22539944 },
    width: 0.3999992, height: 1.05000044, layers: ["bottom"],
    connectedTo: ["pcb_smtpad_altium_8292"],
    circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_altium_8292" },
  }
  const context: PortReservationContext = {
    obstacles: [actualPad], connMap, traceWidth: 0.1,
    traceToPadClearance: 0.1, layerCount: 8,
  }
  const reserve = (points: Array<[number, number, number]>, obstacles: Obstacle[] = [actualPad], clearance = 0.1): number[] => {
    return [...createPortReservationNetIds({
      topology: { portCount: points.length, portX: points.map((p) => p[0]),
        portY: points.map((p) => p[1]), portZ: points.map((p) => p[2]) },
      problem: { routeNet: Int32Array.from([0, 5]), routeMetadata: metadata },
      context: { ...context, obstacles, traceToPadClearance: clearance },
    })]
  }
  const before = JSON.stringify({ actualPad, netMap: connMap.netMap, metadata })
  const bad597: [number, number, number] = [283.02670011, 121.70039899999998, 7]
  expect(reserve([bad597])).toEqual([0])
  expect(reserve([[bad597[0], bad597[1], 0]])).toEqual([-1])
  expect(reserve([[actualPad.center.x, actualPad.center.y, 7]])).toEqual([0])
  const left = actualPad.center.x - actualPad.width / 2
  expect(reserve([[left - 0.15, actualPad.center.y, 7]])).toEqual([-1])
  expect(reserve([[left - 0.149, actualPad.center.y, 7]])).toEqual([0])
  expect(reserve([[left - 0.249, actualPad.center.y, 7]], [actualPad], 0.2)).toEqual([0])
  expect(reserve([[left - 0.25, actualPad.center.y, 7]], [actualPad], 0.2)).toEqual([-1])
  expect(reserve([bad597], [{ ...actualPad, connectedTo: [] }])).toEqual([-2])
  expect(reserve([bad597], [{ ...actualPad, connectedTo: ["single-terminal-pad"] }])).toEqual([-2])
  expect(reserve([bad597], [actualPad, { ...actualPad, connectedTo: ["pad129"] }])).toEqual([-2])
  expect(reserve([bad597], [actualPad, { ...actualPad }])).toEqual([0])
  expect(reserve([bad597], [{ ...actualPad, connectedTo: [], circuitJsonMetadata: undefined }])).toEqual([-1])
  expect(reserve([bad597], [{ ...actualPad, connectedTo: [], isNonPlatedHole: true }])).toEqual([-1])
  const rotated: Obstacle = { ...actualPad, center: { x: 0, y: 0 }, width: 2, height: 0.2,
    ccwRotationDegrees: 45, layers: ["top"] }
  expect(reserve([[0.65, 0.65, 0], [0.7, -0.7, 0]], [rotated])).toEqual([0, -1])
  const circle: Obstacle = { ...rotated, width: 1, height: 1, shape: "circle" }
  expect(reserve([[0.6, 0, 0], [0.6, 0.6, 0]], [circle])).toEqual([0, -1])
  const oval = { ...rotated, ccwRotationDegrees: 0, shape: "oval" } as unknown as Obstacle
  expect(reserve([[1.1, 0, 0], [1.1, 0.2, 0]], [oval])).toEqual([0, -1])
  expect(JSON.stringify({ actualPad, netMap: connMap.netMap, metadata })).toBe(before)
  Object.freeze(actualPad.center)
  Object.freeze(actualPad.connectedTo)
  Object.freeze(actualPad)
  expect(reserve([bad597])).toEqual([0])
  const aliasCollision = new ConnectivityMap({ registered: ["literalA", "padA"],
    other: ["registered", "literalB", "padB"] })
  expect([...createPortReservationNetIds({
    topology: { portCount: 1, portX: [0], portY: [0], portZ: [7] },
    problem: { routeNet: Int32Array.from([0, 5]), routeMetadata: [
      { connectionId: "literalA", mutuallyConnectedNetworkId: "registered" },
      { connectionId: "literalB", mutuallyConnectedNetworkId: "other" },
    ] },
    context: { ...context, connMap: aliasCollision,
      obstacles: [{ ...actualPad, center: { x: 0, y: 0 }, connectedTo: ["registered"] }] },
  })]).toEqual([5])
  expect(() => reserve([bad597], [actualPad], -0.1)).toThrow("Invalid physical")
  expect(() => reserve([[0, 0, 8]])).toThrow("Invalid final native")
})
