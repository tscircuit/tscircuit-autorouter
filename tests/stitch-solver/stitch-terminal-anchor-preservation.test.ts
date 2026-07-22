import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const makeRoute = (
  connectionName: string,
  route: Array<{ x: number; y: number; z: number }>,
): HighDensityIntraNodeRoute => ({
  connectionName,
  rootConnectionName: "root",
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route,
  vias: [],
  jumpers: [],
})

test("stitcher preserves the only collision-free terminal attachment", () => {
  const terminalAnchor = { x: 3, y: 0, z: 0 }
  const isTerminal = (point: { x: number; y: number }): boolean =>
    point.x === 0 || point.x === 4
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "candidate",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 4, y: 0, z: 0 },
    hdRoutes: [
      makeRoute("first", [
        { x: 0.2, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ]),
      makeRoute("terminal_attachment", [
        { x: 1.2, y: 0, z: 0 },
        { x: 2.2, y: 0, z: 0 },
        terminalAnchor,
      ]),
      {
        ...makeRoute("branch", [
          { x: 3.1, y: 0, z: 0 },
          { x: 3.1, y: 1, z: 0 },
        ]),
        startPcbPortId: "branch_port",
      },
    ],
    isValidStitchSegment: ({ start, end }) => {
      if (isTerminal(start) || isTerminal(end)) {
        const terminal = isTerminal(start) ? start : end
        const endpoint = terminal === start ? end : start
        if (terminal.x === 0) return endpoint.x === 0.2
        return endpoint.x === terminalAnchor.x
      }
      return !(
        Math.abs(start.x - terminalAnchor.x) < 1e-3 &&
        Math.abs(end.x - 3.1) < 1e-3
      )
    },
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.route.at(-1)).toMatchObject({
    x: 4,
    y: 0,
    z: 0,
  })
  expect(
    solver.mergedHdRoute.route.filter(
      (point) =>
        point.x === terminalAnchor.x &&
        point.y === terminalAnchor.y &&
        point.z === terminalAnchor.z,
    ),
  ).toHaveLength(2)
})
