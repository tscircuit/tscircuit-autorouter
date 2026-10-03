import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

const createSolver = (): TraceWidthSolver => {
  const route: HighDensityRoute = {
    connectionName: "section",
    rootConnectionName: "root",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0.2, y: 0, z: 0 },
    ],
    vias: [],
  }
  return new TraceWidthSolver({
    hdRoutes: [route],
    connection: [
      { name: "section", nominalTraceWidth: 0.4, pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0.1, y: 0 },
        width: 2,
        height: 1,
        layers: ["top"],
        connectedTo: ["pad"],
      },
    ],
    connMap: new ConnectivityMap({
      target: ["root"],
      foreign: ["pad", "pad-root"],
    }),
    minTraceWidth: 0.1,
    layerCount: 1,
  })
}

test("trace width steps observe net merges and in-place connectivity changes on the same route", (): void => {
  for (const mutation of [
    "merge",
    "connected-to",
    "root-name",
    "map",
    "foreign-connected-to",
  ]) {
    const cached = createSolver()
    const reference = createSolver()
    Object.defineProperty(reference, "isObstacleConnectedToRouteCached", {
      value: (obstacle: Obstacle, route: HighDensityRoute): boolean =>
        isObstacleConnectedToRoute(obstacle, route, reference.connMap),
    })

    const currentRoute = cached.hdRoutes[0]!
    for (const solver of [cached, reference]) {
      if (mutation === "foreign-connected-to") {
        solver.obstacles[0]!.connectedTo[0] = "root"
      }
      solver.step()
      solver.step()
      expect(solver.currentTargetWidth).toBe(
        mutation === "foreign-connected-to" ? 0.4 : 0.25,
      )
      if (mutation === "merge") {
        solver.connMap!.addConnections([["root", "pad"]])
      } else if (mutation === "connected-to") {
        solver.obstacles[0]!.connectedTo[0] = "root"
      } else if (mutation === "root-name") {
        solver.currentTrace!.rootConnectionName = "pad-root"
      } else if (mutation === "foreign-connected-to") {
        solver.obstacles[0]!.connectedTo[0] = "pad"
      } else {
        solver.connMap = new ConnectivityMap({ merged: ["root", "pad"] })
      }
    }
    expect(cached.currentTrace).toBe(currentRoute)

    cached.solve()
    reference.solve()
    expect(cached.solved).toBe(true)
    expect(cached.failed).toBe(false)
    expect(cached.hdRoutesWithWidths).toEqual(reference.hdRoutesWithWidths)
    expect(cached.iterations).toBe(reference.iterations)
    expect(cached.hdRoutesWithWidths[0]!.traceThickness).toBe(
      mutation === "foreign-connected-to" ? 0.1 : 0.25,
    )
  }
})
