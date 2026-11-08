import { expect, test } from "bun:test"
import input from "../../fixtures/standalone-ground-via.json"
import { EscapeViaLocationSolver } from "lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import { getConnectedCopperPourObstacles } from "lib/solvers/EscapeViaLocationSolver/getConnectedCopperPourObstacles"
import { getPreloadedPourPointGroups } from "lib/solvers/EscapeViaLocationSolver/getPreloadedPourPointGroups"
import type { SimpleRouteJson } from "lib/types"

test("standalone ground vias reuse their physical plane connection without duplicate escape drills", (): void => {
  const srj = input as SimpleRouteJson
  const original = structuredClone(srj)
  const solver = new EscapeViaLocationSolver(srj)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.createdEscapeVias).toHaveLength(0)
  expect(solver.getOutputSimpleRouteJson().traces).toEqual(srj.traces)
  expect(srj).toEqual(original)
  for (const variant of [
    "original",
    "unconnected-branch",
    "wrong-layer",
    "non-plated",
    "outside",
    "no-contact",
    "no-net",
  ] as const) {
    const candidate = structuredClone(srj)
    const via = candidate.obstacles.find((o) => o.shape === "circle")!
    if (variant === "unconnected-branch") {
      candidate.traces = []
      candidate.connections[0]!.externallyConnectedPointIds = []
    }
    if (variant === "wrong-layer") via.layers = ["top", "inner2", "bottom"]
    if (variant === "non-plated") via.isNonPlatedHole = true
    if (variant === "outside")
      candidate.obstacles.find((o) => o.isCopperPour)!.center.x = 20
    if (variant === "no-contact") via.center.y = 2
    if (variant === "no-net") via.connectedTo = []
    const pours = candidate.obstacles.filter((o) => o.isCopperPour)
    const groups = getPreloadedPourPointGroups({
      srj: candidate,
      points: candidate.connections[0]!.pointsToConnect,
      matchingPours: pours,
      connectedPourByObstacle: getConnectedCopperPourObstacles(pours),
    })
    const ids = [...groups.values()].flat()
    expect(ids).toEqual(
      variant === "original"
        ? ["pcb_port_1", "pcb_port_2"]
        : variant === "unconnected-branch"
          ? ["pcb_port_2"]
          : [],
    )
  }
})
