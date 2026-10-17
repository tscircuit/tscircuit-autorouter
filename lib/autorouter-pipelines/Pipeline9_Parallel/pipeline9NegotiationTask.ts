import { NegotiateTraceClearanceSolver } from "@tscircuit/repair04"

export type NegotiationInput = ConstructorParameters<typeof NegotiateTraceClearanceSolver>[0]
export type NegotiationResult = ReturnType<NegotiateTraceClearanceSolver["getOutput"]>
export type Pipeline9NegotiationTask = Omit<NegotiationInput, "isLocked" | "onSearch"> & {
  lockedPointIndices: boolean[][]
}
export interface Pipeline9RepairRuntime {
  readonly workerCount: number
  runNegotiations(tasks: Pipeline9NegotiationTask[]): NegotiationResult[]
}

export const runPipeline9NegotiationTask = (
  task: Pipeline9NegotiationTask,
): NegotiationResult => {
  const solver = new NegotiateTraceClearanceSolver({
    ...task,
    isLocked: (routeIndex, pointIndex): boolean => task.lockedPointIndices[routeIndex]![pointIndex]!,
  })
  solver.solve()
  if (solver.failed) throw new Error(`Parallel clearance negotiation failed: ${solver.error}`)
  return solver.getOutput()
}
