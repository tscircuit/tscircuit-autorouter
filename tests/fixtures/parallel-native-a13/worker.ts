import { deepStrictEqual, strictEqual } from "node:assert"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { ParallelPortfolioSingleIntraNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortfolioSingleIntraNodeSolver"
import { createParallelNativeA13SearchInstaller } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createParallelNativeA13SearchInstaller"
import { NativeA13WasmSearchKernel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/a13-search-wasm/NativeA13WasmSearchKernel"
import { initializeWorkerNativeGridRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/workerNativeGridRuntime"
import { registerWorkerNativeGridKernelDispatcher } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/workerNativeGridKernelQuantum"
import { restoreWorkerConnectivityMap } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/restoreWorkerConnectivityMap"
import type { GridHistoryDispatcher, GridHistoryResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGridHistoryTypes"
import type { HighDensitySolverA13WithDrcValidation } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA13WithDrcValidation"
import { JavascriptSearchKernel } from "./JavascriptSearchKernelOracle"

const excluded = new Set(["searchKernel", "pairCache", "timeToSolve", "_setup"])
function state(owner: object): object {
  return Object.fromEntries(Object.entries(owner).filter(([name]) => !excluded.has(name)))
}
async function run(data: any): Promise<object> {
  await initializeWorkerNativeGridRuntime()
  const dispatcher: GridHistoryDispatcher = async (): Promise<Map<number, Promise<GridHistoryResult>>> => new Map()
  registerWorkerNativeGridKernelDispatcher(dispatcher)
  const installer = createParallelNativeA13SearchInstaller(ParallelPortfolioSingleIntraNodeSolver.prototype)
  const params = { ...data.params, connMap: restoreWorkerConnectivityMap(data.params) }
  let candidates = 0, calls = 0, expansions = 0, privateHeapRows = 0, privateArrays = 0, quanta = 0, cPositiveRunCalls = 0
  for (const row of data.rows) {
    const node = params.nodePortPoints.find((value: any) => value.capacityMeshNodeId === row.nodeId)
    strictEqual(node.width, row.width); strictEqual(node.height, row.height)
    const input = { ...params, nodeWithPortPoints: node }
    const parent = new ParallelPortfolioSingleIntraNodeSolver(input, async () => new Map(), { policy: "ordered", gridHistoryDispatcher: dispatcher })
    const nativeParent = new PortfolioSingleIntraNodeSolver(input)
    const owner = nativeParent.generateSolver(row.hyperParameters) as unknown as HighDensitySolverA13WithDrcValidation
    const control: any = nativeParent.generateSolver(row.hyperParameters)
    const originalSetup = control._setup
    control._setup = function(): void {
      originalSetup.call(this)
      this.searchKernel = new JavascriptSearchKernel(this.cols, this.rows, this.layers.length, this.pitchX, this.pitchY)
    }
    strictEqual(installer.install(owner, parent, dispatcher), true)
    let active: ReturnType<typeof installer.beginQuantum> = null
    try {
      for (let step = 0; step < row.steps; step++) {
        if (step % 100 === 0) {
          installer.finishQuantum(active)
          active = installer.beginQuantum(owner, parent, dispatcher)
          strictEqual(active !== null, true, "actual worker A13 must enter its original selected quantum")
          quanta++
        }
        const before = (owner as any).routingIterations
        control.step(); owner.step(); calls++
        if ((owner as any).routingIterations > before) cPositiveRunCalls++
        deepStrictEqual(state(owner), state(control))
        const actual: any = owner
        if (actual.searchKernel) {
          strictEqual(actual.searchKernel instanceof NativeA13WasmSearchKernel, true)
          const expected = control.searchKernel.proofState(), kernel = actual.searchKernel
          const memory = kernel.exports.memory.buffer, offsets = kernel.offsets
          const scalars = new DataView(memory)
          // Shipped, pinned module's disassembled scalar addresses. A regenerated
          // binary must pass this full private-state oracle before it is accepted.
          strictEqual(scalars.getInt32(65648, true), expected.heapSize)
          strictEqual(scalars.getInt32(65636, true), expected.goal)
          strictEqual(Object.is(scalars.getFloat64(65640, true), expected.presentCost), true)
          for (const [name, Type, offset] of [["distance", Float64Array, 8], ["parent", Int32Array, 9],
            ["stateXY", Int32Array, 10], ["versions", Uint32Array, 12]] as const) {
            deepStrictEqual(new Type(memory, offsets[offset], kernel.states), expected[name]); privateArrays++
          }
          const flags = new Int32Array(memory, offsets[11], kernel.states)
          for (let index = 0; index < flags.length; index++) strictEqual(flags[index], expected.stateFlags[index])
          strictEqual(kernel.heapCapacity, expected.heapCapacity)
          const heap = new DataView(memory, offsets[13], kernel.heapCapacity * 16)
          for (let index = 0; index < kernel.heapCapacity; index++) {
            strictEqual(Object.is(heap.getFloat64(index * 16, true), expected.heapF[index]), true)
            strictEqual(heap.getInt32(index * 16 + 8, true), expected.heapIndex[index])
            strictEqual(heap.getUint32(index * 16 + 12, true), expected.heapVersion[index])
          }
          privateHeapRows += kernel.heapCapacity
        }
        if (step % 100 === 0 || control.solved || control.failed || step === row.steps - 1) deepStrictEqual(owner.getOutput(), control.getOutput())
      }
    } finally { installer.finishQuantum(active) }
    strictEqual((owner as any).routingIterations, row.routingIterations)
    candidates++; expansions += (owner as any).routingIterations
  }
  return { candidates, calls, expansions, cExpansions: expansions, cPositiveRunCalls, privateHeapRows, privateArrays, quanta,
    actualKernel: true, guardCensus: installer.getGuardCensus() }
}
self.onmessage = async (event: MessageEvent): Promise<void> => {
  try { self.postMessage({ result: await run(event.data) }) }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.stack : String(error) }) }
}
