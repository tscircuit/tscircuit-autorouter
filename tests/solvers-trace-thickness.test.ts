import { describe, it, expect } from "vitest"
import { IntraNodeSolver } from "../lib/solvers/IntraNodeSolver/IntraNodeSolver"
import { MultiHeadPointerSolver } from "../lib/solvers/MultiHeadPointerSolver/MultiHeadPointerSolver"
import { CapacityMeshSolver } from "../lib/solvers/CapacityMeshSolver/CapacityMeshSolver"
import { TRACE_BASE_WIDTH_MM } from "../lib/types/trace-thickness"

// Helper: verify all routing params scale correctly for a given width
function checkRoutingParams(
  params: ReturnType<IntraNodeSolver["getRoutingParams"]>,
  expectedWidthMm: number,
) {
  const clearance = 0.15
  expect(params.traceWidthMm).toBeCloseTo(expectedWidthMm)
  expect(params.minClearanceMm).toBeCloseTo(clearance)
  expect(params.obstacleRadius).toBeCloseTo(expectedWidthMm / 2 + clearance)
  // gridStep = ceil((width + clearance) / 0.05) * 0.05
  const raw = expectedWidthMm + clearance
  const expectedGrid = Math.ceil(raw / 0.05) * 0.05
  expect(params.gridStep).toBeCloseTo(expectedGrid)
}

// ─── IntraNodeSolver ────────────────────────────────────────────────────────

describe("IntraNodeSolver — trace thickness", () => {
  it("defaults to 0.15 mm when no option provided", () => {
    const solver = new IntraNodeSolver()
    checkRoutingParams(solver.getRoutingParams(), TRACE_BASE_WIDTH_MM)
  })

  it("accepts widthMultiple: 2", () => {
    const solver = new IntraNodeSolver({ traceThickness: { widthMultiple: 2 } })
    checkRoutingParams(solver.getRoutingParams(), 0.30)
  })

  it("accepts widthMultiple: 4", () => {
    const solver = new IntraNodeSolver({ traceThickness: { widthMultiple: 4 } })
    checkRoutingParams(solver.getRoutingParams(), 0.60)
  })

  it("accepts widthMultiple: 8", () => {
    const solver = new IntraNodeSolver({ traceThickness: { widthMultiple: 8 } })
    checkRoutingParams(solver.getRoutingParams(), 1.20)
  })

  it("accepts a raw mm number", () => {
    const solver = new IntraNodeSolver({ traceThickness: 0.45 })
    checkRoutingParams(solver.getRoutingParams(), 0.45)
  })

  it("accepts widthMm in a config object", () => {
    const solver = new IntraNodeSolver({
      traceThickness: { widthMm: 0.9 },
    })
    checkRoutingParams(solver.getRoutingParams(), 0.9)
  })

  it("obstacle radius grows proportionally with trace width", () => {
    const thin = new IntraNodeSolver({ traceThickness: { widthMultiple: 1 } })
    const thick = new IntraNodeSolver({ traceThickness: { widthMultiple: 4 } })
    expect(thick.obstacleRadius).toBeGreaterThan(thin.obstacleRadius)
  })

  it("grid step grows proportionally with trace width", () => {
    const thin = new IntraNodeSolver({ traceThickness: { widthMultiple: 1 } })
    const thick = new IntraNodeSolver({ traceThickness: { widthMultiple: 8 } })
    expect(thick.gridStep).toBeGreaterThan(thin.gridStep)
  })
})

// ─── MultiHeadPointerSolver ─────────────────────────────────────────────────

describe("MultiHeadPointerSolver — trace thickness", () => {
  it("defaults to 0.15 mm when no option provided", () => {
    const solver = new MultiHeadPointerSolver()
    checkRoutingParams(solver.getRoutingParams(), TRACE_BASE_WIDTH_MM)
  })

  it("accepts widthMultiple: 2", () => {
    const solver = new MultiHeadPointerSolver({
      traceThickness: { widthMultiple: 2 },
    })
    checkRoutingParams(solver.getRoutingParams(), 0.30)
  })

  it("accepts widthMultiple: 8", () => {
    const solver = new MultiHeadPointerSolver({
      traceThickness: { widthMultiple: 8 },
    })
    checkRoutingParams(solver.getRoutingParams(), 1.20)
  })
})

// ─── CapacityMeshSolver ─────────────────────────────────────────────────────

describe("CapacityMeshSolver — trace thickness", () => {
  it("defaults to 0.15 mm when no option provided", () => {
    const solver = new CapacityMeshSolver()
    checkRoutingParams(solver.getRoutingParams(), TRACE_BASE_WIDTH_MM)
  })

  it("accepts widthMultiple: 4", () => {
    const solver = new CapacityMeshSolver({
      traceThickness: { widthMultiple: 4 },
    })
    checkRoutingParams(solver.getRoutingParams(), 0.60)
  })

  it("accepts widthMultiple: 8", () => {
    const solver = new CapacityMeshSolver({
      traceThickness: { widthMultiple: 8 },
    })
    checkRoutingParams(solver.getRoutingParams(), 1.20)
  })
})
