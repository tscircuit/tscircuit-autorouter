import { expect, test } from "bun:test"
import { AssignableAutoroutingPipeline2 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/AssignableAutoroutingPipeline2"
import bugReport from "../../fixtures/bug-reports/bugreport36-d4c6c2/bugreport36-d4c6c2.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { AssignableAutoroutingPipeline3 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline3/AssignableAutoroutingPipeline3"

const srj = bugReport.simple_route_json as SimpleRouteJson

test(
  "bugreport36-d4c6c2",
  () => {
    const solver = new AssignableAutoroutingPipeline3(srj)
    // solver.solve()
    while (solver.iterations < 3294) {
      solver.step()
    }

    // The solver is now at the iteration where we're seeing a connected obstacle
    // register as a colliding segment, we can add logging to diagnose further
    const keepoutSolver = solver.traceKeepoutSolver!

    // Check the jumpers passed to the keepout solver
    console.log("=== JUMPERS PASSED TO KEEPOUT SOLVER ===")
    const jumpers = (keepoutSolver as any).input.jumpers
    for (const jumper of jumpers ?? []) {
      console.log("Jumper center:", jumper.center)
      for (const pad of jumper.pads) {
        console.log("  Pad:", {
          center: pad.center,
          connectedTo: pad.connectedTo,
        })
      }
    }

    // Check the jumper solver to see what keys it's generating
    const jumperSolver = solver.highDensitySolver?.jumperSolvers[0] as any
    if (jumperSolver?.winningSolver) {
      const winSolver = jumperSolver.winningSolver
      console.log("=== JUMPER SOLVER ROUTES ===")
      for (const route of winSolver.solvedRoutes) {
        console.log("Route:", route.connectionName, route.rootConnectionName)
        for (const jumper of route.jumpers) {
          const centerX = (jumper.start.x + jumper.end.x) / 2
          const centerY = (jumper.start.y + jumper.end.y) / 2
          console.log("  Route jumper center:", {
            centerX: centerX.toFixed(3),
            centerY: centerY.toFixed(3),
            start: jumper.start,
            end: jumper.end,
          })
        }
      }
      console.log("=== JUMPER LOCATIONS ===")
      for (const loc of winSolver.jumperLocations) {
        console.log("  JumperLoc center:", {
          x: loc.center.x.toFixed(3),
          y: loc.center.y.toFixed(3),
        })
      }
    }

    // Check the currentTrace's jumpers
    console.log("=== CURRENT TRACE JUMPERS ===")
    console.log({
      connectionName: keepoutSolver.currentTrace?.connectionName,
      rootConnectionName: keepoutSolver.currentTrace?.rootConnectionName,
      jumpers: keepoutSolver.currentTrace?.jumpers?.map((j) => ({
        start: j.start,
        end: j.end,
      })),
    })

    console.log("=== COLLIDING SEGMENTS ===")
    console.log({
      currentTrace: keepoutSolver.currentTrace,
      lastCollidingSegments: keepoutSolver.lastCollidingSegments.map((seg) => ({
        startX: seg.start.x.toFixed(2),
        startY: seg.start.y.toFixed(2),
        endX: seg.end.x.toFixed(2),
        endY: seg.end.y.toFixed(2),
      })),
      lastCursorPosition: keepoutSolver.lastCursorPosition,
    })

    // expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    //   import.meta.path,
    // )
  },
  { timeout: 180_000 },
)
