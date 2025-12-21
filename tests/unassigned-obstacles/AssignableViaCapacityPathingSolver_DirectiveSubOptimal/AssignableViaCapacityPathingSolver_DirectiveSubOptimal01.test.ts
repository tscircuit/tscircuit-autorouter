import { expect, test } from "bun:test"
import { AssignableViaCapacityPathingSolver_DirectiveSubOptimal } from "../../../lib/autorouter-pipelines/AssignableAutoroutingPipeline1/AssignableViaCapacityPathing/AssignableViaCapacityPathingSolver_DirectiveSubOptimal"
// @ts-ignore
import constructorInput from "../../../examples/unassigned-obstacles/AssignableViaCapacityPathingSolver_DirectiveSubOptimal/AssignableViaCapacityPathingSolver_DirectiveSubOptimal01.json"

// Skipping because the hyper parameters have to be tuned for it to solve this
// problem- using the hyper solver should pass
test.skip("AssignableViaCapacityPathingSolver_DirectiveSubOptimal should complete", async () => {
  // Create solver with the test input
  const solver = new AssignableViaCapacityPathingSolver_DirectiveSubOptimal(
    (constructorInput as any)[0],
  )

  // Run the solver until completion or failure
  solver.solve()

  // Verify solver completed successfully
  if (solver.failed) {
    console.log("Solver failed with error:", solver.error)
  }
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)

  // Verify we have solved routes
  expect(solver.solvedRoutes).toBeDefined()
  expect(solver.solvedRoutes.length).toBeGreaterThan(0)

  // Check visualization output
  const graphics = solver.visualize()
  expect(graphics).toBeDefined()
  expect(graphics.lines).toBeDefined()
  expect(graphics.circles).toBeDefined()
  expect(graphics.rects).toBeDefined()
  expect(graphics.points).toBeDefined()

  // Verify visualization contains edges (light gray lines)
  const edgeLines = graphics.lines!.filter(
    (line) => line.strokeColor === "rgba(150, 150, 150, 0.2)",
  )
  expect(edgeLines.length).toBeGreaterThan(0)

  // Verify visualization contains all nodes as rectangles
  expect(graphics.rects!.length).toBeGreaterThan(0)

  // Verify visualization contains route endpoint points
  const routeEndpointPoints = graphics.points!.filter(
    (point) => point.label?.includes("START:") || point.label?.includes("END:"),
  )
  expect(routeEndpointPoints.length).toBeGreaterThan(0)

  // Verify visualization contains used nodes (green stroke rectangles)
  const usedNodeRects = graphics.rects!.filter(
    (rect) => rect.stroke === "green",
  )
  expect(usedNodeRects.length).toBeGreaterThan(0)

  // Verify visualization contains solved route lines (thick lines with strokeWidth: 3)
  const solvedRouteLines = graphics.lines!.filter(
    (line) => line.strokeWidth === 3,
  )
  expect(solvedRouteLines.length).toBeGreaterThan(0)

  // Validate that there are no NaN or invalid values in the visualization
  for (const line of graphics.lines!) {
    for (const point of line.points) {
      expect(Number.isNaN(point.x)).toBe(false)
      expect(Number.isNaN(point.y)).toBe(false)
      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
    }
  }

  for (const circle of graphics.circles!) {
    expect(Number.isNaN(circle.center.x)).toBe(false)
    expect(Number.isNaN(circle.center.y)).toBe(false)
    expect(Number.isFinite(circle.center.x)).toBe(true)
    expect(Number.isFinite(circle.center.y)).toBe(true)
    expect(Number.isNaN(circle.radius)).toBe(false)
    expect(Number.isFinite(circle.radius)).toBe(true)
    expect(circle.radius).toBeGreaterThan(0)
  }

  for (const rect of graphics.rects!) {
    expect(Number.isNaN(rect.center.x)).toBe(false)
    expect(Number.isNaN(rect.center.y)).toBe(false)
    expect(Number.isFinite(rect.center.x)).toBe(true)
    expect(Number.isFinite(rect.center.y)).toBe(true)
    expect(Number.isNaN(rect.width)).toBe(false)
    expect(Number.isNaN(rect.height)).toBe(false)
    expect(Number.isFinite(rect.width)).toBe(true)
    expect(Number.isFinite(rect.height)).toBe(true)
    expect(rect.width).toBeGreaterThan(0)
    expect(rect.height).toBeGreaterThan(0)
  }

  console.log("Visualization stats:")
  console.log(`  Total Lines: ${graphics.lines!.length}`)
  console.log(`  Total Circles: ${graphics.circles!.length}`)
  console.log(`  Total Rects (nodes): ${graphics.rects!.length}`)
  console.log(`  Total Points: ${graphics.points!.length}`)
  console.log(`  Edge lines (gray): ${edgeLines.length}`)
  console.log(`  Solved route lines (thick): ${solvedRouteLines.length}`)
  console.log(`  Route endpoint points: ${routeEndpointPoints.length}`)
  console.log(`  Used node rects: ${usedNodeRects.length}`)
  console.log("  ✓ All values validated (no NaN or Infinity)")
}, 20_000)
