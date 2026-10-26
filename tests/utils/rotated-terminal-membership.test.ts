import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"

test("rotated-pad membership preserves terminal locations and obstacle conversion", (): void => {
  // Original sample024 U52.7 precedes same-net U52.6/U52.8 in obstacle order.
  // Whole-net connectedTo aliases must not make its unrotated box own their centers.
  const sharedIds = ["pcb_port_altium_7883", "pcb_port_altium_7884", "pcb_port_altium_7885", "source_net_altium_pcb_385"]
  const original: SimpleRouteJson = {
    bounds: { minX: 80, maxX: 90, minY: 150, maxY: 160 },
    layerCount: 8,
    minTraceWidth: 0.1,
    obstacles: [
      { id: "7883", y: 156.06009935999998 },
      { id: "7884", y: 156.69509936 },
      { id: "7885", y: 155.42509936 },
    ].map(({ id, y }) => ({
      obstacleId: `pcb_smtpad_altium_${id}`, type: "rect", layers: ["bottom"],
      center: { x: 83.75780048, y }, width: 0.39999919999999994, height: 1.44999964,
      ccwRotationDegrees: 90, connectedTo: [...sharedIds],
      circuitJsonMetadata: { pcb_smtpad_id: `pcb_smtpad_altium_${id}`, pcb_port_id: `pcb_port_altium_${id}` },
    })),
    connections: [{ name: "source_net_altium_pcb_385", pointsToConnect: [
      { x: 83.75780048, y: 156.69509936, layer: "bottom", pointId: "pcb_port_altium_7884", pcb_port_id: "pcb_port_altium_7884", port_selector: "U52.6" },
      { x: 83.75780048, y: 155.42509936, layer: "bottom", pointId: "pcb_port_altium_7885", pcb_port_id: "pcb_port_altium_7885", port_selector: "U52.8" },
    ] }],
  }
  const snapshot = structuredClone(original)
  const converted = addApproximatingRectsToSrj(original)
  expect(converted.connections).toEqual(original.connections)
  expect(converted.obstacles).toEqual(original.obstacles.map(({ ccwRotationDegrees: _rotation, width, height, ...obstacle }) => ({
    ...obstacle, width: height, height: width,
  })))
  expect(original).toEqual(snapshot)

  for (const rotation of [0, 35, 90, 180, -35, 270]) {
    const angle = rotation * Math.PI / 180
    const points = [-1, 1].flatMap((sign) => [
      // A physical interior point, a point outside the rotated shape, and
      // its closed local-frame corners. Reflecting exercises both pad ends.
      { x: sign * (1.8 * Math.cos(angle) - 0.1 * Math.sin(angle)), y: sign * (1.8 * Math.sin(angle) + 0.1 * Math.cos(angle)) },
      { x: sign * (rotation % 180 === 0 ? 2.2 : 1.8), y: 0 },
      ...[-1, 1].map((ySign) => ({ x: sign * 2 * Math.cos(angle) - ySign * 0.2 * Math.sin(angle),
        y: sign * 2 * Math.sin(angle) + ySign * 0.2 * Math.cos(angle) })),
    ]).map((point, index) => ({ ...point, layer: "top", pointId: `control-${index}`, pcb_port_id: `control-${index}` }))
    const ids = points.map((point) => point.pointId)
    const input: SimpleRouteJson = {
      layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
      obstacles: [
        { type: "rect", center: { x: 0, y: 0 }, width: 4, height: 0.4, ccwRotationDegrees: rotation,
          obstacleId: "rotated-first", layers: ["top"], connectedTo: ids },
        ...points.map((point) => ({ type: "rect" as const, center: { x: point.x, y: point.y }, width: 0.02, height: 0.02,
          obstacleId: `own-${point.pointId}`, layers: ["top"], connectedTo: ids })),
      ],
      connections: [{ name: "controls", pointsToConnect: points }],
    }
    const before = structuredClone(input)
    const output = addApproximatingRectsToSrj(input)
    expect(output.connections).toEqual(before.connections)
    expect(output.obstacles).toEqual(addApproximatingRectsToSrj({ ...before, connections: [] }).obstacles)
    expect(input).toEqual(before)
  }
})
