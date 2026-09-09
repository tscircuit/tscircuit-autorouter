import { expect, test } from "bun:test"
import { BasePipelineSolver } from "@tscircuit/solver-utils"
import { PadJunctionSimplificationSolver } from "lib/solvers/PadJunctionSimplificationSolver/PadJunctionSimplificationSolver"
import { createPadJunctionFixture } from "../fixtures/pad-junction"

test("each pipeline stage visualizes its geometry and keeps the current pad highlighted", () => {
  const input = createPadJunctionFixture()
  for (const x of [10, 20])
    input.obstacles.push({
      ...input.obstacles[0]!,
      center: { x, y: 0 },
      connectedTo: [],
    })
  const solver = new PadJunctionSimplificationSolver(input)
  expect(solver).toBeInstanceOf(BasePipelineSolver)
  solver.step()
  for (const padIndex of [0, 1, 2]) {
    solver.step()
    const graphics = solver.visualize()
    expect(graphics.coordinateSystem).toBe("cartesian")
    const highlight = graphics.lines?.find(
      (line) => line.label === "Current pad",
    )
    if (!highlight) throw new Error("Expected current-pad highlight")
    const xs = highlight.points.map((point) => point.x)
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBe(
      input.obstacles[padIndex]!.center.x,
    )
    if (padIndex === 0)
      expect(
        graphics.lines?.filter((line) => line.label === "Run"),
      ).toHaveLength(2)
  }
  expect(solver.getCurrentStageName()).toBe("constructPadTsSolver")
  solver.step()
  solver.step()
  const proposal = solver.constructPadTsSolver.visualize()
  expect(proposal.lines?.some((line) => line.label === "Head")).toBe(true)
  expect(proposal.lines?.some((line) => line.label === "Stem")).toBe(true)
  expect(proposal.points?.some((point) => point.label === "Junction")).toBe(
    true,
  )
  expect(solver.acceptedReplacement).toBeNull()
  expect(solver.outcomes).toEqual([])
  expect(solver.getCurrentStageName()).toBe("applyPadTsSolver")
  solver.step()
  solver.step()
  expect(solver.outcomes[0]?.outcome).toBe("accepted")
  const applied = solver.applyPadTsSolver.visualize()
  expect(applied.lines?.some((line) => line.label === "Current pad")).toBe(true)
  expect(applied.title).toBe(
    "Replaced V with a straight head and perpendicular stem",
  )
  // Earlier stage views still show the original routes after application.
  expect(solver.constructPadTsSolver.visualize()).toEqual(proposal)
  solver.step()
  expect(solver.solved).toBe(true)
  expect(solver.visualize().coordinateSystem).toBe("cartesian")
  expect(
    solver.visualize().lines?.some((line) => line.label === "Current pad"),
  ).toBe(false)
})
