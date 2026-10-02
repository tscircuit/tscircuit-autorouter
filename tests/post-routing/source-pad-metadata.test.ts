import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { restorePostRoutingPadMetadata } from "lib/utils/restorePostRoutingPadMetadata"
import { optimizePostRouting } from "lib/solvers/PostRoutingOptimization/optimizePostRouting"
import { createDynamicNetTreeProblem } from "lib/solvers/DynamicNetTreeSolver/createDynamicNetTreeProblem"
import { boardFixture, phaseOptions } from "./fixtures"

function fixture() {
  const input = boardFixture()
  const pad = input.srj.obstacles[0]!
  pad.layers = ["top", "bottom"]
  pad.circuitJsonMetadata = { pcb_plated_hole_id: "pad-a", pcb_port_id: "a" }
  const source = [
    {
      type: "pcb_plated_hole",
      pcb_plated_hole_id: "pad-a",
      pcb_port_id: "a",
      shape: "circular_hole_with_rect_pad",
      x: pad.center.x,
      y: pad.center.y,
      rect_pad_width: pad.width,
      rect_pad_height: pad.height,
      rect_ccw_rotation: pad.ccwRotationDegrees,
      hole_diameter: 0.3,
      layers: ["top", "bottom"],
    },
  ] as AnyCircuitElement[]
  return { input, source }
}

test("authoritative exact pad identity restores drill and plating without mutating input or geometry", () => {
  const { input, source } = fixture()
  const original = structuredClone({ input, source })
  const physical = restorePostRoutingPadMetadata(input.srj, source)
  expect(physical.obstacles[0]!.isPlated).toBe(true)
  expect(physical.obstacles[0]!.holeDiameter).toBe(0.3)
  expect(physical.obstacles[0]!.holeShape).toBe("circle")
  const { isPlated, holeDiameter, holeShape, landShape, ...land } = physical.obstacles[0]!
  expect(land).toEqual(input.srj.obstacles[0])
  expect({ input, source }).toEqual(original)
  expect(physical).not.toBe(input.srj)
  // Connected aliases and a coincident position alone are not plating evidence.
  delete input.srj.obstacles[0]!.circuitJsonMetadata
  expect(
    restorePostRoutingPadMetadata(input.srj, source).obstacles[0]!.isPlated,
  ).toBeUndefined()
  expect(
    restorePostRoutingPadMetadata(original.input.srj, []).obstacles[0]!
      .isPlated,
  ).toBeUndefined()
})

test("source mismatches and conflicting explicit physical facts fail rather than relaxing rules", () => {
  for (const defect of [
    "port",
    "position",
    "layers",
    "shape",
    "plating",
    "drill",
    "duplicate",
  ] as const) {
    const { input, source } = fixture()
    const pad = source[0] as unknown as Record<string, unknown>
    if (defect === "port") pad.pcb_port_id = "foreign"
    if (defect === "position") pad.x = 9
    if (defect === "layers") pad.layers = ["top"]
    if (defect === "shape")
      (input.srj.obstacles[0]! as unknown as { type: string }).type = "circle"
    if (defect === "plating") input.srj.obstacles[0]!.isPlated = false
    if (defect === "drill") input.srj.obstacles[0]!.holeDiameter = 0.4
    if (defect === "duplicate") source.push(structuredClone(source[0]!))
    expect(() => restorePostRoutingPadMetadata(input.srj, source)).toThrow()
  }
})

test("slots, missing drills and offset drills remain unsupported and uncertified", () => {
  for (const defect of [
    "slot",
    "missing",
    "offset",
    "unknown",
  ] as const) {
    const { input, source } = fixture()
    const pad = source[0] as unknown as Record<string, unknown>
    if (defect === "slot") {
      delete pad.hole_diameter
      pad.hole_width = 0.2
      pad.hole_height = 0.5
    }
    if (defect === "missing") delete pad.hole_diameter
    if (defect === "offset") pad.hole_offset_x = 0.1
    if (defect === "unknown") pad.shape = "polygon"
    const physical = restorePostRoutingPadMetadata(input.srj, source)
    const result = optimizePostRouting(
      { ...input, srj: physical },
      phaseOptions(),
    )
    expect(result.status).toBe("unsupported")
    expect(result.validationStatus).toBe("unsupported")
    expect(result.traces).toEqual(input.traces)
    expect(result.attempts).toEqual([])
    expect(result.before).toBeNull()
  }
})

test("post-routing via dimensions follow the same canonical defaults and explicit aliases as Pipeline9", () => {
  const input = boardFixture()
  delete input.srj.minViaPadDiameter
  delete input.srj.minViaHoleDiameter
  const problem = () =>
    createDynamicNetTreeProblem(
      input.srj,
      "signal",
      input.traces.slice(1),
      input.traceOwners,
    )
  expect(problem().viaDiameter).toBe(0.3)
  expect(problem().viaHoleDiameter).toBe(0.15)
  input.srj.minViaPadDiameter = 0.8
  input.srj.minViaHoleDiameter = 0.4
  input.srj.min_via_pad_diameter = 0.7
  input.srj.min_via_hole_diameter = 0.35
  expect(problem().viaDiameter).toBe(0.7)
  expect(problem().viaHoleDiameter).toBe(0.35)
})
