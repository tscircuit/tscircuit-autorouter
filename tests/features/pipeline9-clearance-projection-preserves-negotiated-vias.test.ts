import { expect, test } from "bun:test"
import { getNewViaPadViolations } from "@tscircuit/repair04"
import { applyPipeline9ClearanceProjection } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9ClearanceProjection"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("projection preserves a negotiated route when moving its via would fail the outer guard", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  fixture.routes[0]!.route = [
    { x: -4, y: 0, z: 0 },
    { x: -1, y: 0.28, z: 0 },
    { x: 1, y: 0.28, z: 0 },
    { x: 4, y: 0, z: 0 },
  ]
  fixture.originalSrj.obstacles.push({
    type: "rect",
    center: { x: 0, y: 4 },
    width: 1.2,
    height: 1.2,
    layers: ["top"],
    connectedTo: ["owner"],
    circuitJsonMetadata: { pcb_smtpad_id: "own_pad" },
  })
  fixture.originalSrj.connections.push(
    {
      name: "owner",
      pointsToConnect: [
        { x: -1, y: 3, layer: "top" },
        { x: 1, y: 3, layer: "bottom" },
      ],
    },
    {
      name: "foreign",
      pointsToConnect: [
        { x: 0.05, y: 3, layer: "top" },
        { x: 0.05, y: 5, layer: "top" },
      ],
    },
  )
  fixture.routes.push(
    {
      connectionName: "owner",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 3, z: 0 },
        { x: -0.2, y: 4, z: 0 },
        { x: -0.2, y: 4, z: 1 },
        { x: 1, y: 3, z: 1 },
      ],
      vias: [{ x: -0.2, y: 4 }],
    },
    {
      connectionName: "foreign",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0.05, y: 3, z: 0 },
        { x: 0.05, y: 5, z: 0 },
      ],
      vias: [],
    },
  )
  const negotiatedRoutes = structuredClone(fixture.routes)
  const previousRoutes = structuredClone(fixture.routes)
  // Removing a redundant planar point during rerouting changes the via's
  // indices even though the existing physical via has not moved.
  previousRoutes[1]!.route.splice(1, 0, { x: -0.6, y: 3.5, z: 0 })
  const previousSnapshot = structuredClone(previousRoutes)
  const projected = applyPipeline9ClearanceProjection(fixture)
  expect(projected[1]!.vias).not.toEqual(negotiatedRoutes[1]!.vias)
  expect(
    getNewViaPadViolations({
      srj: { ...fixture.originalSrj, traces: undefined },
      previousRoutes,
      routes: projected,
    }),
  ).toHaveLength(1)

  const result = applyPipeline9ClearanceProjection({
    ...fixture,
    previousRoutes,
  })
  expect(result).toBe(fixture.routes)
  expect(result).toEqual(negotiatedRoutes)
  expect(previousRoutes).toEqual(previousSnapshot)
  expect(
    getNewViaPadViolations({
      srj: { ...fixture.originalSrj, traces: undefined },
      previousRoutes,
      routes: result,
    }),
  ).toEqual([])
})
