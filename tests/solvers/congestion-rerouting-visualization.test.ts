import { expect, test } from "bun:test"
import { createCongestionFixture } from "../fixtures/congestion-rerouting"
import { CongestionReroutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/CongestionReroutingSolver"

test("debug frames expose selection, temporary blocking, search, and the committed detour", (): void => {
  const solver = new CongestionReroutingSolver(createCongestionFixture())
  const phases: string[] = []
  while (!solver.solved && !solver.failed) {
    solver.step()
    phases.push(solver.phase)
    const graphics = solver.visualize({ focus: true })
    expect(graphics.texts?.length ?? 0).toBe(0)
    const obstacle = graphics.rects?.find(rect => rect.label?.includes("TEMPORARY OBSTACLE"))
    expect(Boolean(obstacle)).toBe(solver.phase === "blocked" || solver.phase === "searching")
    if (solver.phase === "blocked") {
      expect(solver.activeSubSolver?.visualize().rects?.some(rect => rect.label?.startsWith("TEMPORARY OBSTACLE:"))).toBe(true)
      expect(obstacle?.center).toEqual({ x: 0, y: 0 })
      expect(obstacle?.width).toBe(1)
      expect(obstacle?.height).toBe(1)
      expect(obstacle?.layer).toBe("z0")
      expect(graphics.lines?.some(line => line.label?.startsWith("Previous path: route 0"))).toBe(true)
      expect(graphics.lines?.some(line => line.label?.startsWith("Assigned path: route 0"))).toBe(false)
      expect(graphics.lines?.some(line => line.label?.startsWith("Assigned path: route 1"))).toBe(true)
    }
    if (solver.phase === "accepted") {
      expect(graphics.lines?.some(line => line.label?.startsWith("Assigned path: route 0"))).toBe(true)
      expect(solver.stats.maxPf).toBe(0)
    }
  }
  expect(phases).toContain("selected")
  expect(phases).toContain("blocked")
  expect(phases).toContain("searching")
  expect(phases).toContain("accepted")
  expect(phases.at(-1)).toBe("complete")
  expect(solver.getOutput().state.regionSegments[0].map(([routeId]) => routeId)).toEqual([1])
})
