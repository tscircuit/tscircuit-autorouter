import assert from "node:assert/strict"
import { importReference } from "./tsReference"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { CrossingViaReductionSolver } from "../../../lib/solvers/CrossingViaReductionSolver/crossing-via-reduction-solver"
import { createCrossingViaReductionRoutes } from "../../../tests/fixtures/crossing-via-reduction-routes"
import { createMultiRouteCrossing, createSameRouteMultiSectionCrossing } from "../../../tests/fixtures/crossing-via-reduction-multi-crossing-routes"
const reference = await importReference<any>("lib/solvers/CrossingViaReductionSolver/crossing-via-reduction-solver.ts")
const { breakRouteIntoSections } = await importReference<any>("lib/solvers/UselessViaRemovalSolver/break-route-into-sections.ts")

for (const [name, create] of [["single",createCrossingViaReductionRoutes],["multi",createMultiRouteCrossing],["same-route",createSameRouteMultiSectionCrossing]] as const) {
  for (const reverse of [false,true]) {
    const routes=create()
    if (reverse) routes[1]!.route.reverse()
    const make = (): any => ({ inputHdRoutes:structuredClone(routes),obstacles:[],layerCount:2,
      connMap:new ConnectivityMap(Object.fromEntries(routes.map(route=>[`${route.connectionName}-net`,[route.connectionName]]))) })
    const actual=new CrossingViaReductionSolver(make()), expected=new reference.CrossingViaReductionSolver(make())
    if (name === "single" && !reverse) {
      const aRoute = actual.reducedHdRoutes[0]!, bRoute = expected.reducedHdRoutes[0]
      const aSections = breakRouteIntoSections(aRoute), bSections = breakRouteIntoSections(bRoute)
      const a = (actual as any).collapseDetourSection({ route: aRoute, section: aSections[1], targetZ: 0 })
      const b = expected.collapseDetourSection({ route: bRoute, section: bSections[1], targetZ: 0 })
      assert.equal(JSON.stringify(a), JSON.stringify(b), "private collapse helper")
      assert.equal(JSON.stringify((actual as any).findCrossingReduction()), JSON.stringify(expected.findCrossingReduction()), "private candidate helper")
    }
    const original=actual.reducedHdRoutes
    let steps=0
    while(!expected.solved&&!expected.failed){
      actual.step();expected.step();steps++
      for(const key of ["iterations","MAX_ITERATIONS","solved","failed","error","progress","stats"]){assert.deepEqual((actual as any)[key],expected[key],`${name}/${reverse} step${steps} ${key}`)}
      assert.equal(actual.reducedHdRoutes,original)
      assert.equal(JSON.stringify(actual.getReducedHdRoutes()),JSON.stringify(expected.getReducedHdRoutes()),`${name}/${reverse} routes step${steps}`)
      if(steps>100)throw new Error("Crossing fixture did not terminate")
    }
    console.log(`${name}/${reverse}: ${steps} exact steps`)
  }
}
