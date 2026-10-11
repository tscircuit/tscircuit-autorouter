import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { buildPhysicalConnectivity } from "../scripts/parallel-benchmark/parallelBenchmarkPhysicalConnectivity"

test("physical coverage uses pill and polygon copper rather than bounding boxes and respects plated layer spans", () => {
  const elements: AnyCircuitElement[] = [
    {
      type: "pcb_smtpad", shape: "pill", pcb_smtpad_id: "horizontal",
      pcb_port_id: "horizontal-port", x: 0, y: 0,
      width: 4, height: 2, radius: 1, layer: "top",
    },
    {
      type: "pcb_smtpad", shape: "rotated_pill", pcb_smtpad_id: "rotated",
      pcb_port_id: "rotated-port", x: 10, y: 0,
      width: 4, height: 2, radius: 1, ccw_rotation: 45, layer: "top",
    },
    {
      type: "pcb_smtpad", shape: "pill", pcb_smtpad_id: "vertical",
      pcb_port_id: "vertical-port", x: -10, y: 0,
      width: 2, height: 4, radius: 1, layer: "bottom",
    },
    {
      type: "pcb_smtpad", shape: "pill", pcb_smtpad_id: "small-radius",
      pcb_port_id: "small-radius-port", x: -20, y: 0,
      width: 4, height: 2, radius: 0.25, layer: "top",
    },
    {
      type: "pcb_smtpad", shape: "polygon", pcb_smtpad_id: "triangle",
      pcb_port_id: "polygon-port", layer: "top",
      points: [{ x: 0, y: 10 }, { x: 4, y: 10 }, { x: 0, y: 14 }],
    },
    {
      type: "pcb_plated_hole", shape: "pill", pcb_plated_hole_id: "barrel",
      pcb_port_id: "barrel-port", x: 20, y: 0,
      outer_width: 4, outer_height: 2, hole_width: 3, hole_height: 1,
      ccw_rotation: 0, layers: ["top", "bottom"],
    },
    {
      type: "pcb_plated_hole", shape: "pill", pcb_plated_hole_id: "partial-barrel",
      pcb_port_id: "partial-port", x: 30, y: 0,
      outer_width: 4, outer_height: 2, hole_width: 3, hole_height: 1,
      ccw_rotation: 0, layers: ["inner1", "bottom"],
    },
  ]
  const physical = buildPhysicalConnectivity(elements, 4)
  for (const point of [{ x: 0, y: 0 }, { x: 1.5, y: 0 }, { x: 2, y: 0 }]) {
    expect(physical.getContacts(point, ["top"])).toHaveLength(1)
    expect(physical.getContacts(point, ["top"])[0]!.padPortId).toBe("horizontal-port")
  }
  // This point is inside the enclosing rectangle, beyond the curved end cap.
  expect(physical.getContacts({ x: 1.8, y: 0.8 }, ["top"])).toEqual([])
  expect(physical.getContacts({ x: 2.1, y: 0 }, ["top"])).toEqual([])
  expect(physical.getContacts({ x: 0, y: 0 }, ["inner1", "inner2", "bottom"])).toEqual([])

  const diagonal = Math.SQRT1_2
  expect(physical.getContacts({ x: 10 + 1.5 * diagonal, y: 1.5 * diagonal }, ["top"])).toHaveLength(1)
  expect(physical.getContacts({ x: 10 + 2 * diagonal, y: 2 * diagonal }, ["top"])).toHaveLength(1)
  // Local (1.5, 0.9) rotated 45 degrees remains inside the AABB, outside copper.
  expect(physical.getContacts({ x: 10 + 0.6 * diagonal, y: 2.4 * diagonal }, ["top"])).toEqual([])
  expect(physical.getContacts({ x: 10, y: 0 }, ["bottom"])).toEqual([])

  expect(physical.getContacts({ x: -10, y: 1.5 }, ["bottom"])).toHaveLength(1)
  expect(physical.getContacts({ x: -9.2, y: 1.8 }, ["bottom"])).toEqual([])
  expect(physical.getContacts({ x: -10, y: 0 }, ["top"])).toEqual([])

  // A declared small radius keeps copper beyond a capsule's curved end.
  const smallRadiusInterior = physical.getContacts({ x: -18.1, y: 0.7 }, ["top"])
  expect(smallRadiusInterior.length).toBeGreaterThan(0)
  for (const contact of smallRadiusInterior) {
    expect(contact.padPortId).toBe("small-radius-port")
    expect(contact.component).toBe(smallRadiusInterior[0]!.component)
  }
  expect(physical.getContacts({ x: -18.02, y: 0.98 }, ["top"])).toEqual([])

  for (const point of [{ x: 1, y: 11 }, { x: 2, y: 12 }, { x: 0, y: 10 }]) {
    expect(physical.getContacts(point, ["top"])).toHaveLength(1)
    expect(physical.getContacts(point, ["top"])[0]!.padPortId).toBe("polygon-port")
  }
  expect(physical.getContacts({ x: 3, y: 13 }, ["top"])).toEqual([])
  expect(physical.getContacts({ x: 2, y: 12.01 }, ["top"])).toEqual([])
  expect(physical.getContacts({ x: 1, y: 11 }, ["bottom"])).toEqual([])

  const barrelTop = physical.getContacts({ x: 21.5, y: 0 }, ["top"])
  expect(barrelTop).toHaveLength(1)
  expect(barrelTop[0]!.padPortId).toBe("barrel-port")
  for (const layer of ["inner1", "inner2", "bottom"]) {
    const contacts = physical.getContacts({ x: 21.5, y: 0 }, [layer])
    expect(contacts).toHaveLength(1)
    expect(contacts[0]!.component).toBe(barrelTop[0]!.component)
  }
  expect(physical.getContacts({ x: 21.8, y: 0.8 }, ["top", "inner1", "inner2", "bottom"])).toEqual([])
  const partialInner = physical.getContacts({ x: 31.5, y: 0 }, ["inner1"])
  expect(partialInner).toHaveLength(1)
  for (const layer of ["inner2", "bottom"]) {
    const contacts = physical.getContacts({ x: 31.5, y: 0 }, [layer])
    expect(contacts).toHaveLength(1)
    expect(contacts[0]!.component).toBe(partialInner[0]!.component)
  }
  expect(physical.getContacts({ x: 31.5, y: 0 }, ["top"])).toEqual([])
})
