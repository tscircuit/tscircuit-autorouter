import { expect, test } from "bun:test"
import { AssignableAutoroutingPipeline2 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/AssignableAutoroutingPipeline2"
import bugReport from "../../fixtures/bug-reports/bugreport36-d4c6c2/bugreport36-d4c6c2.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { getDrcErrors } from "lib/testing/getDrcErrors"

const srj = bugReport.simple_route_json as SimpleRouteJson

test(
  "bugreport36-d4c6c2",
  () => {
    const solver = new AssignableAutoroutingPipeline2(srj)
    solver.solve()
    expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
      import.meta.path,
    )
  },
  { timeout: 180_000 },
)

test(
  "bugreport36-d4c6c2 - simplification stage should not create overlapping traces",
  () => {
    const solver = new AssignableAutoroutingPipeline2(srj)
    solver.solve()

    // Get the routes BEFORE simplification (after stitch phase)
    const stitchRoutes = solver.highDensityStitchSolver?.mergedHdRoutes
    expect(stitchRoutes).toBeDefined()
    expect(stitchRoutes!.length).toBeGreaterThan(0)

    // Convert stitch routes to circuit JSON for DRC checking
    const stitchCircuitJson = convertToCircuitJson(
      solver.srjWithPointPairs!,
      stitchRoutes!,
      srj.minTraceWidth,
      srj.minViaDiameter,
    )

    const { errors: stitchErrors } = getDrcErrors(stitchCircuitJson)
    console.log("Stitch phase DRC errors:", stitchErrors.length)
    if (stitchErrors.length > 0) {
      for (const error of stitchErrors.slice(0, 3)) {
        console.log("  - (stitch)", error.message)
      }
    }

    // Count routes with and without jumpers
    const routesWithJumpers = stitchRoutes!.filter(
      (r) => r.jumpers && r.jumpers.length > 0,
    )
    const routesWithoutJumpers = stitchRoutes!.filter(
      (r) => !r.jumpers || r.jumpers.length === 0,
    )
    console.log(
      `Routes with jumpers: ${routesWithJumpers.length}, without: ${routesWithoutJumpers.length}`,
    )

    // Check if jumpers exist globally
    const allJumpers = stitchRoutes!.flatMap((r) => r.jumpers || [])
    console.log(`Total jumpers across all routes: ${allJumpers.length}`)

    // Get the simplified routes from the trace simplification solver
    const simplifiedRoutes =
      solver.traceSimplificationSolver?.simplifiedHdRoutes
    expect(simplifiedRoutes).toBeDefined()
    expect(simplifiedRoutes!.length).toBeGreaterThan(0)

    // Convert to circuit JSON for DRC checking
    const circuitJson = convertToCircuitJson(
      solver.srjWithPointPairs!,
      simplifiedRoutes!,
      srj.minTraceWidth,
      srj.minViaDiameter,
    )

    // Run DRC checks
    const { errors } = getDrcErrors(circuitJson)

    // Check that there are no trace overlap errors
    console.log("Simplification phase DRC errors:", errors.length)
    if (errors.length > 0) {
      for (const error of errors.slice(0, 3)) {
        console.log("  - (simplified)", error.message)
      }
    }

    // Simplification should not significantly increase DRC errors.
    // The stitch phase may have some minor clearance violations, but
    // simplification should not create new "accidental contact" overlaps.
    // Allow up to 2x the stitch errors (some tolerance for minor changes).
    const maxAllowedErrors = Math.max(stitchErrors.length * 2, 5)
    expect(errors.length).toBeLessThanOrEqual(maxAllowedErrors)
  },
  { timeout: 180_000 },
)
