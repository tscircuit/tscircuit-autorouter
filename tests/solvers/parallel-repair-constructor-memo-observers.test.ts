import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ParallelHighDensityRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelHighDensityRepairSolver"
import { createNativeRepairConnectivityMemoFactory } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createNativeRepairConnectivityMemoFactory"
import { initializeReferenceDrcRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import type { HighDensityRoute } from "lib/types/high-density-types"

type Params = ConstructorParameters<typeof Pipeline4HighDensityRepairSolver>[0]
const workerPool = { run(): never { throw new Error("Constructor must not dispatch") } }
function createParams(): Params {
  const route = (rootConnectionName: string | undefined, x: number): HighDensityRoute => ({
    connectionName: "route-a", rootConnectionName, regionId: "node", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{x, y: 0, z: 0}, {x: x + 0.1, y: 0, z: 1}], vias: [{x, y: 0}],
  })
  return {
    nodeWithPortPoints: [{capacityMeshNodeId: "node", center: {x: 0, y: 0}, width: 10, height: 10, portPoints: []}],
    hdRoutes: [route(undefined, 0), route(undefined, 2), route("", 3), route("root-a", 4)],
    obstacles: [
      {type: "rect", layers: ["top", "bottom"], center: {x: 0, y: 0}, width: 0.4, height: 0.4, connectedTo: ["foreign"]},
      {type: "rect", layers: ["top", "bottom"], center: {x: 2, y: 0}, width: 0.4, height: 0.4, connectedTo: ["route-a"]},
    ],
    connMap: new ConnectivityMap({A: ["route-a", "pad-a"], B: ["foreign"], "route-a": ["asymmetric-id"], root: ["root-a"]}),
  }
}

test("repair constructor memo keeps asymmetric aliases and declines observing methods, getters, proxies and numeric callbacks", async () => {
  await initializeReferenceDrcRuntime()
  const createMemo = createNativeRepairConnectivityMemoFactory(ParallelHighDensityRepairSolver.prototype)
  const plain = createParams()
  // A native merged alias can share its net array while retaining the earlier
  // idToNetMap identity. Electrical answers must use the actual native map.
  plain.connMap!.netMap.B = plain.connMap!.netMap.A!
  const owner = new ParallelHighDensityRepairSolver({...plain, workerPool})
  const memo = createMemo(owner, plain)!
  expect(memo).toBeDefined()
  const roots: (string | undefined)[] = [undefined, "", "root-a"]
  const aliasObstacle = {...plain.obstacles[0]!, connectedTo: ["asymmetric-id"]}
  const reverseObstacle = {...plain.obstacles[0]!, connectedTo: ["route-a"]}
  const emptyRootObstacle = {...plain.obstacles[0]!, connectedTo: [""]}
  const namedRootObstacle = {...plain.obstacles[0]!, connectedTo: ["root-a"]}
  expect(plain.connMap!.areIdsConnected("route-a", "asymmetric-id")).toBe(true)
  expect(plain.connMap!.areIdsConnected("asymmetric-id", "route-a")).toBe(false)
  for (let repeat = 0; repeat < 4; repeat++) for (const rootConnectionName of roots) {
    for (const connectionName of ["route-a", "asymmetric-id", "__proto__", "constructor"]) {
      for (const obstacle of [plain.obstacles[0]!, plain.obstacles[1]!, aliasObstacle, reverseObstacle, emptyRootObstacle, namedRootObstacle]) {
        const route = {connectionName, rootConnectionName}
        expect(memo(obstacle, route, plain.connMap)).toBe(isObstacleConnectedToRoute(obstacle, route, plain.connMap))
      }
    }
  }
  const prototype = Object.getPrototypeOf(owner)
  expect(Object.hasOwn(plain.connMap!, "areIdsConnected")).toBe(false)
  expect(Object.getPrototypeOf(owner)).toBe(prototype)
  expect(memo(emptyRootObstacle, {connectionName: "route-a", rootConnectionName: undefined}, plain.connMap)).toBe(false)
  expect(memo(emptyRootObstacle, {connectionName: "route-a", rootConnectionName: ""}, plain.connMap)).toBe(true)

  type Installer = (params: Params, log: string[]) => (() => void) | undefined
  const scenarios: Installer[] = [
    (params, log) => {
      const original = params.connMap!.areIdsConnected
      params.connMap!.areIdsConnected = function(left, right) {
        log.push(`query:${left}:${right}`)
        if (log.length === 3) this.idToNetMap.foreign = "A"
        return original.call(this, left, right)
      }
      return undefined
    },
    (params, log) => {
      const point = params.hdRoutes[0]!.route[0]!
      const x = point.x
      Object.defineProperty(point, "x", {configurable: true, enumerable: true, get() {
        log.push("point-x")
        params.connMap!.idToNetMap.foreign = "A"
        return x
      }})
      return undefined
    },
    (params, log) => {
      const obstacle = params.obstacles[0]!
      params.obstacles[0] = new Proxy(obstacle, {get(target, property, receiver) {
        log.push(`obstacle-get:${String(property)}`)
        return Reflect.get(target, property, receiver)
      }, ownKeys(target) {log.push("obstacle-ownKeys"); return Reflect.ownKeys(target)}})
      return undefined
    },
    (params, log) => {
      const original = Math.abs
      Math.abs = function(value) {
        log.push("math-abs")
        params.connMap!.idToNetMap.foreign = "A"
        return original(value)
      }
      return () => {Math.abs = original}
    },
  ]
  for (const install of scenarios) {
    const run = (parallel: boolean) => {
      const params = createParams(), log: string[] = []
      const restore = install(params, log)
      try {
        const solver = parallel ? new ParallelHighDensityRepairSolver({...params, workerPool}) : new Pipeline4HighDensityRepairSolver(params)
        return {samples: solver.sampleEntries, log}
      } finally {restore?.()}
    }
    const native = run(false), parallel = run(true)
    expect(parallel.samples).toEqual(native.samples)
    expect(parallel.log).toEqual(native.log)
  }

  for (const parallel of [false, true]) {
    const params = createParams(), log: string[] = []
    params.connMap!.areIdsConnected = (left, right) => {
      log.push(`${left}:${right}`)
      throw new Error("original-query-boundary")
    }
    expect(() => parallel ? new ParallelHighDensityRepairSolver({...params, workerPool}) : new Pipeline4HighDensityRepairSolver(params)).toThrow("original-query-boundary")
    expect(log).toEqual(["route-a:foreign"])
  }
})
