import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("shared-root search preserves a child's owned path instead of borrowing a third terminal", (): void => {
  const chainPoints: HighDensityIntraNodeRoute["route"] = [
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 2.2, y: 0, z: 0 },
    { x: 3.8, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
    { x: 6, y: 0, z: 0 },
  ]
  const ownRoutes = [0, 2, 4].map(
    (pointIndex): HighDensityIntraNodeRoute => ({
      connectionName: "a-to-b",
      rootConnectionName: "shared-root",
      ...(pointIndex === 0 ? { startPcbPortId: "port-a" } : {}),
      ...(pointIndex === 4 ? { endPcbPortId: "port-b" } : {}),
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [chainPoints[pointIndex]!, chainPoints[pointIndex + 1]!],
      vias: [],
    }),
  )
  const siblingRoutes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "a-to-c",
      rootConnectionName: "shared-root",
      startPcbPortId: "port-a",
      endPcbPortId: "port-c",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [chainPoints[0]!, { x: 3, y: 2, z: 0 }],
      vias: [],
    },
    {
      connectionName: "c-to-b",
      rootConnectionName: "shared-root",
      startPcbPortId: "port-c",
      endPcbPortId: "port-b",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [{ x: 3, y: 2, z: 0 }, chainPoints[5]!],
      vias: [],
    },
  ]
  const connections: SimpleRouteConnection[] = [
    {
      name: "a-to-b",
      __rootConnectionNames: ["shared-root"],
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "port-a" },
        { x: 6, y: 0, layer: "top", pcb_port_id: "port-b" },
      ],
    },
    {
      name: "a-to-c",
      __rootConnectionNames: ["shared-root"],
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "port-a" },
        { x: 3, y: 2, layer: "top", pcb_port_id: "port-c" },
      ],
    },
    {
      name: "c-to-b",
      __rootConnectionNames: ["shared-root"],
      pointsToConnect: [
        { x: 3, y: 2, layer: "top", pcb_port_id: "port-c" },
        { x: 6, y: 0, layer: "top", pcb_port_id: "port-b" },
      ],
    },
  ]
  const originalRoutes = [...ownRoutes, ...siblingRoutes]
  const originalSnapshot = structuredClone({ originalRoutes, connections })

  // The sibling path has no new gaps, while the child's declared copper
  // requires two clear 0.2 mm joins. Gap minimization must not route through
  // a third terminal that the child connection does not own.
  for (const reverseInput of [false, true]) {
    const hdRoutes = reverseInput
      ? [...originalRoutes].reverse().map(
          (route): HighDensityIntraNodeRoute => ({
            ...route,
            startPcbPortId: route.endPcbPortId,
            endPcbPortId: route.startPcbPortId,
            route: [...route.route].reverse(),
          }),
        )
      : originalRoutes
    const inputSnapshot = structuredClone(hdRoutes)
    const solver = new MultipleHighDensityRouteStitchSolver3({
      connections,
      hdRoutes,
      layerCount: 2,
      preserveTerminalPcbPortIds: true,
      allowedLayerTransitionPointKeys: new Set<string>(),
    })
    const child = solver.unsolvedRoutes.find(
      (route): boolean => route.connectionName === "a-to-b",
    )!
    expect(child.hdRoutes).toHaveLength(3)
    expect(
      child.hdRoutes.every(
        (route): boolean => route.connectionName === "a-to-b",
      ),
    ).toBeTrue()
    solver.solve()

    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(solver.mergedHdRoutes).toHaveLength(3)
    const merged = solver.mergedHdRoutes.find(
      (route): boolean => route.connectionName === "a-to-b",
    )!
    const startsAtA = merged.startPcbPortId === "port-a"
    expect(merged.endPcbPortId).toBe(startsAtA ? "port-b" : "port-a")
    expect(merged.route).toEqual(
      startsAtA ? chainPoints : [...chainPoints].reverse(),
    )
    expect(merged.traceThickness).toBe(0.15)
    expect(merged.viaDiameter).toBe(0.3)
    expect(merged.vias).toEqual([])
    for (const sibling of siblingRoutes) {
      const mergedSibling = solver.mergedHdRoutes.find(
        (route): boolean => route.connectionName === sibling.connectionName,
      )!
      const sameDirection =
        mergedSibling.startPcbPortId === sibling.startPcbPortId
      expect(mergedSibling.endPcbPortId).toBe(
        sameDirection ? sibling.endPcbPortId : sibling.startPcbPortId,
      )
      expect(mergedSibling.route).toEqual(
        sameDirection ? sibling.route : [...sibling.route].reverse(),
      )
      expect(mergedSibling.vias).toEqual([])
    }
    expect(hdRoutes).toEqual(inputSnapshot)
    expect({ originalRoutes, connections }).toEqual(originalSnapshot)
  }
})
