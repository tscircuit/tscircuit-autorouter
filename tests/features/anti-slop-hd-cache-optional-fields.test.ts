import { expect, test } from "bun:test"
import { Pipeline5HdCacheHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/Pipeline5HdCacheHighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("remote route normalization preserves optional fields, zero values and insertion order", async (): Promise<void> => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "remote",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1],
    portPoints: ["A", "B", "C"].flatMap((connectionName, index) => [
      { x: -1, y: index, z: 0, connectionName, rootConnectionName: "root" },
      { x: 1, y: index, z: 0, connectionName, rootConnectionName: "root" },
    ]),
  }
  let calls = 0
  const fetchImpl: typeof fetch = Object.assign(
    async (): Promise<Response> => {
      calls += 1

      return new Response(
        JSON.stringify({
          ok: true,
          source: "cache",
          routes: [
            { connectionName: "A", route: [{ x: 0, y: 0, z: 0 }], vias: [] },
            {
              connectionName: "B",
              traceThickness: 0,
              viaDiameter: 0,
              route: [{ x: 0, y: 1, z: 0, insideJumperPad: false }],
              vias: [],
              jumpers: [],
            },
            {
              connectionName: "C",
              rootConnectionName: "remote-root",
              route: [{ x: 0, y: 2, z: 0, insideJumperPad: true }],
              vias: [],
              jumpers: [
                {
                  route_type: "jumper",
                  start: { x: 0, y: 2 },
                  end: { x: 1, y: 2 },
                  footprint: "0603",
                },
              ],
            },
          ],
        }),
        { status: 200 },
      )
    },
    { preconnect(): void {} },
  )
  const solver = new Pipeline5HdCacheHighDensitySolver({
    nodePortPoints: [node],
    fetchImpl,
    traceWidth: 0.2,
    viaDiameter: 0.5,
  })
  solver.step()
  await Promise.all(solver.pendingEffects!.map((effect) => effect.promise))
  solver.step()
  expect(calls).toBe(1)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.routes).toHaveLength(3)
  const [absent, empty, present] = solver.routes
  expect(Object.keys(absent!)).toEqual([
    "connectionName",
    "rootConnectionName",
    "traceThickness",
    "viaDiameter",
    "route",
    "vias",
  ])
  expect(absent!.rootConnectionName).toBe("root")
  expect(absent!.traceThickness).toBe(0.2)
  expect(absent!.viaDiameter).toBe(0.5)
  expect(Object.hasOwn(absent!, "jumpers")).toBe(false)
  expect(Object.hasOwn(absent!.route[0]!, "insideJumperPad")).toBe(false)
  expect(empty!.traceThickness).toBe(0)
  expect(empty!.viaDiameter).toBe(0)
  expect(empty!.jumpers).toEqual([])
  expect(Object.keys(empty!).at(-1)).toBe("jumpers")
  expect(Object.hasOwn(empty!.route[0]!, "insideJumperPad")).toBe(false)
  expect(present!.rootConnectionName).toBe("remote-root")
  expect(present!.route[0]).toEqual({ x: 0, y: 2, z: 0, insideJumperPad: true })
  expect(Object.keys(present!.route[0]!)).toEqual([
    "x",
    "y",
    "z",
    "insideJumperPad",
  ])
  expect(Object.keys(present!).at(-1)).toBe("jumpers")
  expect(present!.jumpers).toEqual([
    {
      route_type: "jumper",
      start: { x: 0, y: 2 },
      end: { x: 1, y: 2 },
      footprint: "0603",
    },
  ])
})
