import { test, expect } from "bun:test"
import { firstNativeContact } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearanceExperimental/createNativeObstacleEventSearch"
test("first contact uses disk and capsule geometry rather than bounding boxes", () => {
  const disk={a:{x:0,y:0,z:0},b:{x:0,y:0,z:0},radius:1,minZ:0,maxZ:0,rectCos:1,rectSin:0}
  expect(firstNativeContact({x:-3,y:0},{x:3,y:0},disk,0)).toBeCloseTo(1/3,12)
  expect(firstNativeContact({x:-3,y:0.99},{x:3,y:0.99},disk,0)).toBeGreaterThan(0.47)
  const capsule={...disk,a:{x:0,y:-1,z:0},b:{x:0,y:1,z:0},radius:0.25}
  expect(firstNativeContact({x:-2,y:0},{x:2,y:0},capsule,0.25)).toBeCloseTo(0.375,12)
})
