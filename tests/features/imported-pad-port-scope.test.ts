import { expect, test } from "bun:test"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { getSrjWithImportedPadPortIds } from "lib/testing/utils/getSrjWithImportedPadPortIds"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import fixture from "../fixtures/assets/a64-foreign-pad-escape.json"

function createImportedPad(
  component: string,
  net: string,
  x: number,
): Obstacle {
  const id = `${component}.1`
  return {
    obstacleId: id,
    type: "rect",
    shape: "circle",
    layers: ["top"],
    center: { x, y: 0 },
    width: 0.4,
    height: 0.4,
    connectedTo: [net, id],
    circuitJsonMetadata: {
      source_component_name: component,
      source_port_name: "1",
    },
  }
}

test("imported pad port IDs stay scoped to associated physical terminals", (): void => {
  const srj = structuredClone(fixture.srj) as SimpleRouteJson
  const canonicalSourcePad = createImportedPad("U6", "canonical-owner", 6)
  canonicalSourcePad.obstacleId = "opaque-imported-pad-id"
  srj.bounds = { minX: -1, maxX: 134, minY: -87, maxY: 1 }
  srj.obstacles.push(
    createImportedPad("U3", "wrong-position-net", 0),
    createImportedPad("U4", "wrong-layer-net", 2),
    createImportedPad("U5", "other-pad-owner", 4),
    canonicalSourcePad,
    createImportedPad("U7", "alias-owner", 8),
    createImportedPad("U8", "root-owner", 12),
    {
      obstacleId: "anonymous-unrelated-obstacle",
      type: "rect",
      layers: ["top"],
      center: { x: 10, y: 0 },
      width: 0.1,
      height: 0.1,
      connectedTo: ["loose-a"],
    },
  )
  srj.connections.push(
    {
      name: "unrelated-net",
      pointsToConnect: [
        { pointId: "loose-a", x: 10, y: 0, layer: "top" },
        {
          pointId: "explicit-point",
          pcb_port_id: "existing-explicit-port",
          x: 11,
          y: 0,
          layer: "top",
        },
      ],
    },
    {
      name: "wrong-position-net",
      pointsToConnect: [{ pointId: "U3.1", x: 0.25, y: 0, layer: "top" }],
    },
    {
      name: "wrong-layer-net",
      pointsToConnect: [{ pointId: "U4.1", x: 2, y: 0, layer: "bottom" }],
    },
    {
      name: "coincident-foreign-net",
      pointsToConnect: [
        { pointId: "foreign-terminal", x: 4, y: 0, layer: "top" },
      ],
    },
    {
      name: "canonical-owner",
      pointsToConnect: [
        { pointId: "U6.1", x: 6, y: 0, layers: ["top", "bottom"] },
      ],
    },
    {
      name: "split-alias-connection",
      __netConnectionName: "alias-owner",
      pointsToConnect: [
        { pointId: "opaque-terminal", x: 8, y: 0, layer: "top" },
      ],
    },
    {
      name: "split-root-connection",
      __rootConnectionNames: ["root-owner"],
      pointsToConnect: [
        { pointId: "opaque-root-terminal", x: 12, y: 0, layer: "top" },
      ],
    },
  )
  const original = structuredClone(srj)
  const projected = getSrjWithImportedPadPortIds(srj)

  expect(projected.connections[0]!.pointsToConnect[0]!.pcb_port_id).toBe(
    "U2.E3",
  )
  expect(
    projected.connections[0]!.pointsToConnect[1]!.pcb_port_id,
  ).toBeUndefined()
  expect(
    projected.connections[1]!.pointsToConnect[0]!.pcb_port_id,
  ).toBeUndefined()
  expect(projected.connections[1]!.pointsToConnect[1]!.pcb_port_id).toBe(
    "existing-explicit-port",
  )
  expect(
    projected.connections[2]!.pointsToConnect[0]!.pcb_port_id,
  ).toBeUndefined()
  expect(
    projected.connections[3]!.pointsToConnect[0]!.pcb_port_id,
  ).toBeUndefined()
  expect(
    projected.connections[4]!.pointsToConnect[0]!.pcb_port_id,
  ).toBeUndefined()
  expect(projected.connections[5]!.pointsToConnect[0]!.pcb_port_id).toBe("U6.1")
  expect(projected.connections[6]!.pointsToConnect[0]!.pcb_port_id).toBe(
    "opaque-terminal",
  )
  expect(projected.connections[7]!.pointsToConnect[0]!.pcb_port_id).toBe(
    "opaque-root-terminal",
  )

  const circuitJson = convertToCircuitJson(srj, [])
  expect(
    circuitJson
      .filter((element) => element.type === "pcb_port")
      .map((element) => element.pcb_port_id)
      .sort(),
  ).toEqual(
    [
      "U2.E3",
      "U6.1",
      "opaque-terminal",
      "opaque-root-terminal",
      "existing-explicit-port",
    ].sort(),
  )
  expect(
    circuitJson.filter(
      (element) =>
        element.type === "pcb_smtpad" &&
        "x" in element &&
        "y" in element &&
        element.x === 10 &&
        element.y === 0,
    ),
  ).toHaveLength(0)
  expect(srj).toEqual(original)

  const noImportedPads = structuredClone(srj)
  for (const obstacle of noImportedPads.obstacles) {
    delete obstacle.circuitJsonMetadata
  }
  expect(getSrjWithImportedPadPortIds(noImportedPads)).toBe(noImportedPads)
})
