import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { getRvboyLcdPortPointRepro } from "../../fixtures/bug-reports/rvboy-lcd-port-points/getRvboyLcdPortPointRepro"

test("RVboy exact phase input retains LCD pad escapes and solves port-point pathing", async () => {
  const inputPath = new URL(
    "../../fixtures/bug-reports/rvboy-lcd-port-points/rvboy-phase1.srj.json",
    import.meta.url,
  )
  expect(
    createHash("sha256").update(readFileSync(inputPath, "utf8")).digest("hex"),
  ).toBe("51be0b31f378d8feb9577d351f8e8aa8164624012e31fb968e2346ad3f0c15d9")
  const { solver, views } = getRvboyLcdPortPointRepro()
  expect(solver.originalSrj.connections).toHaveLength(197)
  expect(solver.originalSrj.obstacles).toHaveLength(1066)
  expect(solver.originalSrj.traces).toHaveLength(28)
  for (const view of views) {
    expect(view.sideEdgeCount).toBeGreaterThan(0)
    expect(view.usableSideEdgeCount).toBe(view.sideEdgeCount)
    await expect(view.svg).toMatchSvgSnapshot(import.meta.path, {
      svgName: view.name,
    })
  }
  while (
    !solver.failed &&
    !solver.solved &&
    !solver.portPointPathingSolver?.solved
  )
    solver.step()
  expect(solver.failed).toBe(false)
  expect(solver.portPointPathingSolver?.solved).toBe(true)
  const pathing = solver.portPointPathingSolver!
  expect(pathing.getSolveGraphBenchmarkMetrics()?.routeCount).toBe(580)
  const routedNames = new Set(
    pathing
      .getOutput()
      .nodesWithPortPoints.flatMap((node) =>
        node.portPoints.map((point) => point.connectionName),
      ),
  )
  for (const connection of pathing.getConstructorParams()[0].connections) {
    expect(
      routedNames.has(connection.connectionId),
      connection.connectionId,
    ).toBe(true)
  }
})
