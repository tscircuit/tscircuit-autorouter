import { expect, test } from "bun:test"
import {
  configureNetworkedBenchmarkRequestTimeout,
  createSolverForTask,
} from "../scripts/benchmark/benchmark-run-task"
import type { BenchmarkTask } from "../scripts/benchmark/benchmark-types"
import type { NodeWithPortPoints } from "../lib/types/high-density-types"

test("the harness applies the same sample budget to existing networked constructors without changing local repair or remote defaults", (): void => {
  const task: BenchmarkTask = {
    datasetName: "srj18",
    solverName: "Pipeline9_Networked Cold",
    solverConstructorName: "AutoroutingPipelineSolver9_Networked",
    networkedCachePass: "cold",
    scenarioName: "fixture",
    sampleNumber: 1,
    scenario: {
      layerCount: 2,
      minTraceWidth: 0.15,
      obstacles: [],
      connections: [],
      bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    },
    networkedServer: {
      url: "http://127.0.0.1:43210",
      cacheVersion: "run-sample-1",
      requestTimeoutMs: 360_000,
    },
  }
  const nodePortPoints: NodeWithPortPoints[] = []
  const boundaryStub = { getOutput: (): NodeWithPortPoints[] => nodePortPoints }
  const pathingStub = {
    getOutput(): {
      nodesWithPortPoints: NodeWithPortPoints[]
      changedPreloadedTraceSections: []
    } {
      return {
        nodesWithPortPoints: nodePortPoints,
        changedPreloadedTraceSections: [],
      }
    },
    computeNodePfMap: (): Map<string, number> => new Map(),
  }
  for (const networkedCachePass of ["cold", "hot"] as const) {
    const solver = createSolverForTask({ ...task, networkedCachePass })
    Object.assign(solver, {
      portPointPathingSolver: pathingStub,
      boundaryContractSolver: boundaryStub,
    })
    const routeStep = solver.pipelineDef.find(
      (step) => step.solverName === "highDensityRouteSolver",
    )!
    const [params] = routeStep.getConstructorParams!(solver) as readonly [
      Record<string, unknown>,
    ]
    expect(params.requestTimeoutMs).toBe(360_000)
    expect(params.hdCache2ServerUrl).toBe(task.networkedServer!.url)
    expect(params.hdCache2CacheVersion).toBe(task.networkedServer!.cacheVersion)
    const StageConstructor = routeStep.solverClass as new (
      params: Record<string, unknown>,
    ) => { requestTimeoutMs: number }
    expect(new StageConstructor(params).requestTimeoutMs).toBe(360_000)
  }
  const ordinaryRemoteTask = {
    ...task,
    networkedServer: {
      url: task.networkedServer!.url,
      cacheVersion: task.networkedServer!.cacheVersion,
    },
  }
  const ordinaryRemoteSolver = createSolverForTask(ordinaryRemoteTask)
  Object.assign(ordinaryRemoteSolver, {
    portPointPathingSolver: pathingStub,
    boundaryContractSolver: boundaryStub,
  })
  const defaultRouteStep = ordinaryRemoteSolver.pipelineDef.find(
    (step) => step.solverName === "highDensityRouteSolver",
  )!
  expect(
    defaultRouteStep.getConstructorParams!(ordinaryRemoteSolver)[0],
  ).not.toHaveProperty("requestTimeoutMs")

  for (const repairIsNetworked of [false, true]) {
    const solver = createSolverForTask(ordinaryRemoteTask)
    const routeParams = {
      autorouterVersion: "fixture-version",
      forceImprove: { totalStepsPerNode: 20 },
      requestTimeoutMs: 30_000,
    }
    const repairParams = repairIsNetworked
      ? { autorouterVersion: "fixture-version", repairMargin: 0.2 }
      : { repairMargin: 0.2 }
    const extraArgument = { positionalMetadata: true }
    const instances: unknown[] = []
    const routeStep = {
      solverName: "highDensityRouteSolver",
      getConstructorParams(
        this: { solverName: string },
        instance: unknown,
      ): unknown[] {
        expect(this).toBe(routeStep)
        instances.push(instance)
        const originalArguments = [routeParams, extraArgument]
        return originalArguments
      },
    }
    const repairStep = {
      solverName: "highDensityRepairSolver",
      getConstructorParams(instance: unknown): unknown[] {
        instances.push(instance)
        const originalArguments = [repairParams, extraArgument]
        expect(originalArguments[0]).toBe(repairParams)
        return originalArguments
      },
    }
    const otherStep = { solverName: "highDensityForceImproveSolver" }
    solver.pipelineDef = [routeStep, repairStep, otherStep]
    configureNetworkedBenchmarkRequestTimeout(solver, 123_456)
    const routeArguments = solver.pipelineDef[0].getConstructorParams!(solver)
    const repairArguments = solver.pipelineDef[1].getConstructorParams!(solver)
    expect(instances).toEqual([solver, solver])
    expect(routeArguments).toEqual([
      { ...routeParams, requestTimeoutMs: 123_456 },
      extraArgument,
    ])
    expect(routeArguments[0]).not.toBe(routeParams)
    expect(routeArguments[1]).toBe(extraArgument)
    expect(routeParams.requestTimeoutMs).toBe(30_000)
    expect(repairArguments).toEqual([
      repairIsNetworked
        ? { ...repairParams, requestTimeoutMs: 123_456 }
        : repairParams,
      extraArgument,
    ])
    if (!repairIsNetworked) expect(repairArguments[0]).toBe(repairParams)
    expect(solver.pipelineDef[2]).toBe(otherStep)
  }
  for (const requestTimeoutMs of [
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    expect(() =>
      createSolverForTask({
        ...task,
        networkedServer: { ...task.networkedServer!, requestTimeoutMs },
      }),
    ).toThrow("request timeout must be positive")
  }
  const incompleteSolver = createSolverForTask(ordinaryRemoteTask)
  incompleteSolver.pipelineDef = []
  expect(() =>
    configureNetworkedBenchmarkRequestTimeout(incompleteSolver, 360_000),
  ).toThrow("routing stage is unavailable")
})
