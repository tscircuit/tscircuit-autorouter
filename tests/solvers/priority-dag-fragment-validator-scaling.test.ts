import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { priorityParams } from "./priorityDagTestUtils"

test("physical search fragments unscale independently of whole-solution validators", (): void => {
  const params = priorityParams()
  let wholeQueries = 0
  const fragmentPoints: number[] = []
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    ...params,
    solutionValidator: (routes): boolean => {
      wholeQueries++
      expect(routes).toHaveLength(3)
      return true
    },
    routeFragmentValidator: (route): boolean => {
      fragmentPoints.push(route.route[1]!.x)
      expect(route.traceThickness).toBe(params.traceWidth!)
      expect(route.viaDiameter).toBe(params.viaDiameter!)
      return false
    },
  })
  Reflect.set(solver, "scaleFactor", 2)
  Reflect.get(solver, "createActiveSubSolver").call(solver)
  const portfolio = solver.activeSubSolver!
  const scaled = portfolio.constructorParams
  const priority = new PriorityDagIntraNodeSolver({ ...scaled, priorityFamilySize: 1 })
  const state = { ancestors: [new Set(), new Set(), new Set()], witnesses: [undefined, undefined, undefined] }
  const options = Reflect.get(priority, "getOptions").call(priority, 0, state)
  const native = Reflect.get(priority, "createNativeSolver").call(priority, options)
  const center = params.nodeWithPortPoints.center
  const parent = { x: center.x, y: center.y, z: 0, g: 0, h: 0, f: 0, parent: null }
  const wire = { ...parent, x: center.x + 0.4, parent }
  expect(native.doesPathToParentIntersectObstacle(wire)).toBeTrue()
  expect(fragmentPoints.at(-1)).toBeCloseTo(center.x + 0.2, 10)
  expect(wholeQueries).toBe(0)
})
