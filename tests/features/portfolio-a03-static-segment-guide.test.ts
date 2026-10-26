import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { StaticRouteSegment } from "lib/types/high-density-types"

test("the A03 portfolio candidate receives the physical segment guide", () => {
  const checkedSegments: StaticRouteSegment[] = []
  const staticSegmentValidator = (segment: StaticRouteSegment): boolean => {
    checkedSegments.push(segment)
    return false
  }
  const portfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "a03-physical-guide",
      center: { x: 12, y: 30 },
      width: 0.02,
      height: 0.02,
      availableZ: [0],
      portPoints: [
        { x: 11.991, y: 30, z: 0, connectionName: "a" },
        { x: 12.009, y: 30, z: 0, connectionName: "a" },
      ],
    },
    traceWidth: 0.1,
    viaDiameter: 0.3,
    staticSegmentValidator,
    priorityCoordinateScale: 4,
  })
  const candidate = portfolio.generateSolver({ HIGH_DENSITY_A03: true })
  expect(candidate).toBeInstanceOf(HighDensitySolverA03)
  const a03 = candidate as unknown as HighDensitySolverA03
  expect(a03.staticSegmentValidator).toBe(staticSegmentValidator)
  expect(a03.coordinateScale).toBe(4)
  a03.solve()
  expect(checkedSegments).toHaveLength(1)
  expect(checkedSegments[0]!.start).toMatchObject({ x: 11.991, y: 30, z: 0 })
  expect(checkedSegments[0]!.end).toMatchObject({ x: 12.009, y: 30, z: 0 })
  expect(a03.failed).toBe(true)
  expect(a03.getOutput()).toEqual([])
  const legacy = new PortfolioSingleIntraNodeSolver({
    ...portfolio.constructorParams,
    staticSegmentValidator: undefined,
  }).generateSolver({ HIGH_DENSITY_A03: true }) as unknown as HighDensitySolverA03
  expect(legacy.coordinateScale).toBe(1)
  legacy.solve()
  expect(legacy.solved).toBe(true)
})
