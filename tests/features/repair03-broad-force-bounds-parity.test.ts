import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { applyBroadRepulsionForces } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { broadForceBoundsAreSeparated } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/broadForceBoundsAreSeparated"
import type { Point } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/internalTypes"
import type { SimpleRouteJson } from "high-density-repair03/lib/types"
import type { HighDensityRoute } from "high-density-repair03/types/high-density-types"

test("current force bounds preserve repeated repulsion route outputs and numeric edge cases", () => {
let state = 91823
const random = (): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
const digest = createHash("sha256")
let comparisons = 0
for (let iteration = 0; iteration < 16; iteration++) {
 const routes: HighDensityRoute[] = Array.from({length:6}, (_, index): HighDensityRoute => {
  const x = random()*3-1.5, y = random()*3-1.5
  return { connectionName:`net_${index}`, rootConnectionName:`root_${index%4}`, traceThickness:0.04+random()*0.4, viaDiameter:0.2+random()*0.5, vias:[], route:[{x,y,z:0},{x:x+random()*0.5,y:y+random()*0.5,z:0},{x:x+random()*0.5,y:y+random()*0.5,z:0},{x:x+random()-0.5,y:y+random()-0.5,z:0}] }
 })
 for (let index = 0; index < routes.length; index += 2) {
  const route=routes[index]!, point=route.route[2]!
  route.route.splice(3,0,{...point,z:1})
  route.route.at(-1)!.z=1
 }
 const srj: SimpleRouteJson={bounds:{minX:-5,maxX:5,minY:-5,maxY:5},layerCount:2,minTraceWidth:0.1,minViaDiameter:0.3,connections:[],obstacles:[{type:"rect",center:{x:0,y:0},width:.4,height:.5,layers:["top"],connectedTo:[]},{type:"rect",center:{x:.8,y:.5},width:.2,height:.6,layers:["top","bottom"],connectedTo:[]}]}
 for (let mutation=0; mutation<2; mutation++) {
  const output=applyBroadRepulsionForces(srj,structuredClone(routes),1,.25,undefined,iteration%2===0)
  digest.update(JSON.stringify(output))
  comparisons++
  for (const route of routes) for (const point of route.route) { point.x+=random()*.03;point.y-=random()*.03 }
 }
}
  expect(comparisons).toBe(32)
  // Complete route coordinates and via positions captured from the original passes.
  expect(digest.digest("hex")).toBe("9ce0c79b91886e32cd277886c168068c75c5443452a79a8032f817eb0ee2832d")
  const leftStart = { x: -0.5, y: 0 }
  const leftEnd = { x: 0.5, y: 0 }
  for (const [gap, separated] of [[0.214999999, false], [0.215, false], [0.216, false], [0.216000001, true]] as const) {
    expect(broadForceBoundsAreSeparated(leftStart, leftEnd, { x: -0.5, y: gap }, { x: 0.5, y: gap }, 0.215)).toBe(separated)
  }
  for (const value of [NaN, Infinity, -Infinity, -1e155, 1e155]) {
    expect(broadForceBoundsAreSeparated({ x: value, y: 10 }, { x: 1, y: 10 }, leftStart, leftEnd, 0.215)).toBe(false)
  }
  // The original projection explicitly returns start for nearly zero length.
  expect(broadForceBoundsAreSeparated({ x: 0, y: 10 }, { x: 1e-170, y: 10 }, leftStart, leftEnd, 0.215)).toBe(true)
  expect(broadForceBoundsAreSeparated({ x: "10", y: 10 } as unknown as Point, { x: "11", y: 10 } as unknown as Point, { x: 101.3, y: 10 }, { x: 101.3, y: 10 }, 0.215)).toBe(false)
})
