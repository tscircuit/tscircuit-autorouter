import assert from "node:assert/strict"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleSimplifiedPathSolver5 } from "../../../lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import { VertexShortcutPathSolver } from "../../../lib/solvers/SimplifiedPathSolver/VertexShortcutPathSolver"
import { MultiSimplifiedPathSolver } from "../../../lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver"
import { importReference } from "./tsReference"

const referencePath = await importReference<typeof import("../../../lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45")>("lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45.ts")
const referenceVertex = await importReference<typeof import("../../../lib/solvers/SimplifiedPathSolver/VertexShortcutPathSolver")>("lib/solvers/SimplifiedPathSolver/VertexShortcutPathSolver.ts")
const referenceMulti = await importReference<typeof import("../../../lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver")>("lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver.ts")
const route = { connectionName: "signal", rootConnectionName: "signal", traceThickness: 0.15, viaDiameter: 0.6, route: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 3, y: 1, z: 0 }], vias: [] }
const stringify = (value: unknown): string | undefined => JSON.stringify(value, (_key, entry) => entry instanceof Map ? [...entry] : entry instanceof Set ? [...entry] : entry)
let comparisons = 0
function same(actual: unknown, expected: unknown, label: string): void {
  assert.equal(stringify(actual), stringify(expected), label)
  comparisons++
}
function params(): any { return { inputRoute: structuredClone(route), otherHdRoutes: [], obstacles: [], colorMap: {}, connMap: new ConnectivityMap({ signal: ["signal"], other: ["other"] }) } }
for (const [Current, Reference] of [[SingleSimplifiedPathSolver5, referencePath.SingleSimplifiedPathSolver5], [VertexShortcutPathSolver, referenceVertex.VertexShortcutPathSolver]] as const) {
  for (const mutate of [false, true, "geometry"]) {
    const pa = params(), pb = params()
    if (mutate === "geometry") {
      for (const p of [pa, pb]) {
        p.otherHdRoutes.push({ connectionName: "other", rootConnectionName: "other", traceThickness: 0.1, viaDiameter: 0.5, route: [{x: 0,y: 1.05,z: 0},{x: 3,y: 1.05,z: 0}], vias: [{x: 2,y: 3}] })
        p.obstacles.push({type: "rect",center: {x: 4,y: 4},width: 1,height: 1,layers: ["top"],__zLayers: [0],connectedTo: []})
        p.outline = [{x:-1,y:-1},{x:5,y:-1},{x:5,y:5},{x:-1,y:5}]
      }
    }
    const a = new Current(pa), b = new Reference(pb)
    const input = a.inputRoute, retained = a.newRoute
    assert.equal(a.newRoute[0] === input.route[0], b.newRoute[0] === b.inputRoute.route[0])
    if (mutate) { a.maxStepSize = b.maxStepSize = 0.2; input.route[0].x = b.inputRoute.route[0].x = -0.1 }
    let previousPathA: unknown, previousPathB: unknown
    for (let step = 0; step < 1000; step++) {
      for (const key of Current.stateFields) {
        if (key === "connMap") continue
        same((a as any)[key], (b as any)[key], `${Current.name}/${mutate}/${step}/${key}`)
      }
      for (const key of ["iterations", "solved", "failed", "error"]) same((a as any)[key], (b as any)[key], `${Current.name}/${step}/${key}`)
      const pathA = (a as any).lastValidPath, pathB = (b as any).lastValidPath
      assert.equal(pathA === previousPathA, pathB === previousPathB, `${Current.name}/${mutate}/${step}/lastValidPath replacement identity`)
      previousPathA = pathA; previousPathB = pathB
      same(a.simplifiedRoute, b.simplifiedRoute, "route")
      if (a.solved || a.failed) break
      a.step(); b.step()
    }
    assert.equal(a.newRoute, retained)
    assert.equal(a.simplifiedRoute.route, retained)
    same(a.visualize(), b.visualize(), "graphics")
    a.dispose()
  }
  const a = new Current(params()), b = new Reference(params())
  a.solve(); b.solve(); same(a.simplifiedRoute, b.simplifiedRoute, "native solve")
  same(a.iterations, b.iterations, "native solve iterations")
  a.dispose()
}
for (const enableVertexShortcuts of [false, true]) {
  const make = (): any => ({ unsimplifiedHdRoutes: [structuredClone(route)], obstacles: [], connMap: new ConnectivityMap({ signal: ["signal"], other: ["other"] }), enableVertexShortcuts })
  const a = new MultiSimplifiedPathSolver(make()), b = new referenceMulti.MultiSimplifiedPathSolver(make())
  let retainedChild: any
  for (let step = 0; step < 1000; step++) {
    for (const key of ["iterations", "solved", "failed", "error", "currentUnsimplifiedHdRouteIndex", "simplifiedHdRoutes"]) same((a as any)[key], (b as any)[key], `multi/${step}/${key}`)
    const ca = a.activeSubSolver, cb = b.activeSubSolver
    same(Boolean(ca), Boolean(cb), "active child presence")
    if (ca && cb) {
      same(ca.simplifiedRoute, cb.simplifiedRoute, "child route")
      if (retainedChild && retainedChild.getSolverName() === ca.getSolverName()) assert.equal(ca, retainedChild)
      retainedChild = ca
    }
    if (a.solved || a.failed) break
    a.step(); b.step()
  }
  a.dispose()
}
{
  const pa = params(), pb = params()
  const a = new SingleSimplifiedPathSolver5(pa), b = new referencePath.SingleSimplifiedPathSolver5(pb)
  pa.inputRoute.route[0].x = pb.inputRoute.route[0].x = -0.15
  pa.inputRoute.route[0].pcb_port_id = pb.inputRoute.route[0].pcb_port_id = "mutated-before-observation"
  a.step(); b.step()
  same(a.newRoute, b.newRoute, "unobserved source point mutation")
  assert.equal(a.inputRoute, pa.inputRoute)
  a.solve(); b.solve()
  same(a.simplifiedRoute, b.simplifiedRoute, "source mutation final route")
  a.dispose()
}
{
  const make = (): any => ({ unsimplifiedHdRoutes: [structuredClone(route)], obstacles: [{ type: "rect", center: {x: 4,y: 4}, width: 1, height: 1, layers: ["top"], connectedTo: [] }] })
  const pa = make(), pb = make()
  const a = new MultiSimplifiedPathSolver(pa), b = new referenceMulti.MultiSimplifiedPathSolver(pb)
  same(pa.obstacles, pb.obstacles, "normalized constructor leaves original obstacle values")
  pa.obstacles[0].center.x = pb.obstacles[0].center.x = 5
  same(a.obstacles, b.obstacles, "normalized shared center mutation")
  assert.equal(a.obstacles[0].center, pa.obstacles[0].center)
  const oldCenter = pa.obstacles[0].center
  pa.obstacles[0].center = pb.obstacles[0].center = {x: 8,y: 8}
  a.step(); b.step()
  same(a.obstacles, b.obstacles, "normalized center replacement detaches")
  assert.equal(a.obstacles[0].center, oldCenter)
  a.solve(); b.solve()
  same(a.simplifiedHdRoutes, b.simplifiedHdRoutes, "normalized mutation final routes")
  a.dispose()
}
{
  const a = new SingleSimplifiedPathSolver5(params()), b = new referencePath.SingleSimplifiedPathSolver5(params())
  const outputA = a.simplifiedRoute, outputB = b.simplifiedRoute
  outputA.route.push({ x: 0.1, y: 0.2, z: 0 }); outputB.route.push({ x: 0.1, y: 0.2, z: 0 })
  outputA.route[0]!.x = outputB.route[0]!.x = -0.05
  a.step(); b.step()
  same(a.simplifiedRoute, b.simplifiedRoute, "output-only retained array mutation")
  assert.equal(a.simplifiedRoute.route, outputA.route)
  a.solve(); b.solve()
  same(a.simplifiedRoute, b.simplifiedRoute, "output-only mutation final route")
  a.dispose()
}
console.log(`Path simplification parity passed ${comparisons} exact comparisons`)
