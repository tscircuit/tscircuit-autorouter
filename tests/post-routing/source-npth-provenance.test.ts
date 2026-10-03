import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { restorePostRoutingPadMetadata } from "lib/utils/restorePostRoutingPadMetadata"
import { createDynamicNetTreeProblem } from "lib/solvers/DynamicNetTreeSolver/createDynamicNetTreeProblem"
import { validatePostRoutingCandidate } from "lib/solvers/PostRoutingOptimization/validatePostRoutingCandidate"
import { boardFixture } from "./fixtures"

test("only an explicit source hole mapping restores nonconductive drill geometry and enforces its clearance", () => {
  const input = boardFixture()
  input.srj.layerCount = 4
  input.srj.obstacles.push({
    componentId: "mechanical",
    type: "rect",
    center: { x: 5, y: 5 },
    width: 1,
    height: 1,
    layers: ["top", "inner1", "inner2", "bottom"],
    connectedTo: [],
  })
  const index = input.srj.obstacles.length - 1
  const source = [
    {
      type: "pcb_hole",
      pcb_hole_id: "drill",
      pcb_component_id: "mechanical",
      hole_shape: "circle",
      x: 5,
      y: 5,
      hole_diameter: 1,
    },
  ] as AnyCircuitElement[]
  const original = structuredClone(input)
  expect(
    restorePostRoutingPadMetadata(input.srj, source).obstacles[index]!
      .isNonPlatedHole,
  ).toBeUndefined()
  expect(
    restorePostRoutingPadMetadata(input.srj, source)
      .unsupportedPhysicalGeometry,
  ).toContain("holes lack obstacle provenance")
  const physical = restorePostRoutingPadMetadata(input.srj, source, {
    drill: index,
  })
  expect(physical.obstacles[index]!.connectedTo).toEqual([])
  expect(physical.obstacles[index]!.sourceHoleId).toBe("drill")
  expect(physical.obstacles[index]!.isNonPlatedHole).toBe(true)
  const hole = createDynamicNetTreeProblem(
    physical,
    "signal",
    [],
    input.traceOwners,
  ).copper.find((c) => c.kind === "hole")!
  expect(hole.layers).toEqual([0, 1, 2, 3])
  expect(hole.drill!.diameter).toBe(1)
  expect(
    validatePostRoutingCandidate(
      physical,
      input.traces,
      input.traceOwners,
    ).diagnostics.some((d) => d.includes("hole:drill")),
  ).toBe(true)
  expect(() =>
    restorePostRoutingPadMetadata(input.srj, source, { drill: 0 }),
  ).toThrow()
  expect(() =>
    restorePostRoutingPadMetadata(input.srj, source, { unknown: index }),
  ).toThrow()
  input.srj.obstacles[index]!.connectedTo = ["signal"]
  expect(() =>
    restorePostRoutingPadMetadata(input.srj, source, { drill: index }),
  ).toThrow()
  input.srj.obstacles[index]!.connectedTo = []
  expect(input).toEqual(original)
})
