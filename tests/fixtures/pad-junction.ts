import { expect } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { PadJunctionSimplificationSolver } from "lib/solvers/PadJunctionSimplificationSolver/PadJunctionSimplificationSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type Input = ConstructorParameters<typeof PadJunctionSimplificationSolver>[0]
export type PadJunctionFixture = Input & {
  hdRoutes: HighDensityRoute[]
  obstacles: Obstacle[]
}

export function createPadJunctionFixture(): PadJunctionFixture {
  return {
    hdRoutes: [-2, 2].map((x, index) => ({
      connectionName: `branch${index}`,
      rootConnectionName: "signal",
      traceThickness: 0.2,
      viaDiameter: 0.3,
      startPcbPortId: `anchor${index}`,
      endPcbPortId: "target",
      route: [
        { x, y: 4, z: 0, pcb_port_id: `anchor${index}` },
        { x: 0, y: 0, z: 0, pcb_port_id: "target" },
      ],
      vias: [],
    })),
    obstacles: [
      {
        type: "rect",
        obstacleId: "target-pad",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        layers: ["top"],
        connectedTo: ["pad-port"],
      },
    ],
    connMap: new ConnectivityMap({
      signal: ["branch0", "branch1", "pad-port"],
    }),
    layerCount: 2,
  }
}

export function solvePadJunction(
  input: Input,
): PadJunctionSimplificationSolver {
  const solver = new PadJunctionSimplificationSolver(input)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  return solver
}

export function expectSharedPerpendicularStem(
  solver: PadJunctionSimplificationSolver,
): void {
  expect(
    solver.outcomes.some((outcome) => outcome.outcome === "accepted"),
  ).toBe(true)
  const [first, second] = solver.getOutput()
  if (!first || !second) throw new Error("Expected two branches")
  const junction = first.route.at(-2)
  const terminal = first.route.at(-1)
  const a = first.route.at(-3)
  const b = second.route.at(-3)
  if (!junction || !terminal || !a || !b)
    throw new Error("Expected a T junction")
  expect(second.route.at(-2)).toEqual(junction)
  const dx = terminal.x - junction.x
  const dy = terminal.y - junction.y
  expect(Math.hypot(dx, dy)).toBeGreaterThan(0.1)
  expect((a.x - junction.x) * dx + (a.y - junction.y) * dy).toBeCloseTo(0, 8)
  expect((b.x - junction.x) * dx + (b.y - junction.y) * dy).toBeCloseTo(0, 8)
  expect(
    (a.x - junction.x) * (b.x - junction.x) +
      (a.y - junction.y) * (b.y - junction.y),
  ).toBeLessThan(0)
}
