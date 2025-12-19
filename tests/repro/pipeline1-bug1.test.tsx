import { test, expect } from "bun:test"
import { AutoroutingPipeline1_OriginalUnravel } from "lib/autorouter-pipelines/AutoroutingPipeline1_OriginalUnravel/AutoroutingPipeline1_OriginalUnravel"
import bugReproJson from "./pipeline1-bug1.json"

test.skip("pipeline1 bug1", () => {
  const solver = new AutoroutingPipeline1_OriginalUnravel(bugReproJson as any, {
    cacheProvider: null,
  })

  solver.solve()

  if (solver.failed) {
    console.error(solver.error)
    if (solver.highDensityRouteSolver?.failedSolvers) {
      console.error("HighDensitySolver failed solvers:")
      for (const failedSolver of solver.highDensityRouteSolver.failedSolvers) {
        console.error(
          `- ${failedSolver.constructor.name}: ${failedSolver.error}`,
        )

        // Log the input to the failed solver
        if ((failedSolver as any).nodeWithPortPoints) {
          console.error("--- BEGIN NODE WITH PORT POINTS FOR DEBUGGING ---")
          console.error(
            JSON.stringify(
              { nodeWithPortPoints: (failedSolver as any).nodeWithPortPoints },
              null,
              2,
            ),
          )
          console.error("--- END NODE WITH PORT POINTS FOR DEBUGGING ---")
        }

        // HyperSingleIntraNodeSolver has supervisedSolvers
        if ("supervisedSolvers" in failedSolver) {
          console.error("  - Supervised solvers:")
          for (const supervised of (failedSolver as any).supervisedSolvers) {
            if (supervised.solver.failed) {
              console.error(
                `    - ${supervised.solver.constructor.name}: ${supervised.solver.error}`,
              )
              if (supervised.solver.failedSubSolvers) {
                console.error("      - Nested failed sub-solvers:")
                for (const nested of supervised.solver.failedSubSolvers) {
                  console.error(
                    `        - ${nested.constructor.name}: ${nested.error}`,
                  )
                }
              }
            }
          }
        }
      }
    }
  }

  expect(solver.solved).toBe(true)
})
