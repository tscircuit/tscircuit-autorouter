import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "../../lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { preparePipeline9DrcRoutedTraces } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preparePipeline9DrcRoutedTraces"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { getDrcErrors } from "../../lib/testing/getDrcErrors"
import type { HighDensityRoute } from "../../lib/types/high-density-types"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../../lib/types"
import { loadScenarios } from "./scenarios"

const DATASET_COMMIT = "f566b62be0f83395d9ab63ddc068f9d645b68b16"
const EXPECTED_SAMPLE_IDS = [
  1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 20, 25, 32, 33, 34, 35, 36, 37, 38, 39, 40,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56,
].map((id) => `sample${String(id).padStart(3, "0")}`)

type Result = {
  sample: string
  inputSha256: string
  solved: boolean
  timedOut: boolean
  error?: string
  elapsedTimeMs: number
  stageTiming?: Record<string, number>
  relaxedErrors?: object[]
  strictErrors?: object[]
  postRepair03RelaxedErrors?: object[]
  postRepair03StrictErrors?: object[]
  postRepair04RelaxedErrors?: object[]
  postRepair04StrictErrors?: object[]
  repair04Stats?: unknown
}

const args = process.argv.slice(2)
const option = (name: string, defaultValue: string): string => {
  const index = args.indexOf(name)
  if (index < 0) return defaultValue
  const value = args[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name} value`)
  return value
}
const mode = option("--mode", "baseline")
if (mode !== "baseline" && mode !== "candidate") throw new Error("Invalid mode")
const outDir = resolve(option("--out-dir", `repair04-benchmark/${mode}`))
const concurrency = Number(option("--concurrency", "2"))
const timeoutMs = Number(option("--timeout-ms", "1800000"))
const effort = Number(option("--effort", "1"))
if (
  ![concurrency, timeoutMs, effort].every(
    (value) => Number.isFinite(value) && value > 0,
  )
) {
  throw new Error("Concurrency, timeout, and effort must be positive numbers")
}
if (!Number.isInteger(concurrency))
  throw new Error("Concurrency must be an integer")
await mkdir(outDir, { recursive: true })
const scenarios = await loadScenarios("srj33")
if (
  JSON.stringify(scenarios.map(([name]) => name)) !==
  JSON.stringify(EXPECTED_SAMPLE_IDS)
) {
  throw new Error("SRJ33 membership differs from the pinned 37-board dataset")
}

const evaluate = (
  inputSrj: SimpleRouteJson,
  srjWithPointPairs: SimpleRouteJson,
  routedTraces: SimplifiedPcbTrace[],
): { relaxedErrors: object[]; strictErrors: object[] } => {
  const relaxed = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs,
    routedTraces,
  })
  return {
    relaxedErrors: relaxed.errorsWithCenters,
    strictErrors: getDrcErrors(relaxed.circuitJson).errorsWithCenters,
  }
}

const runWorker = async (sample: string): Promise<void> => {
  const entry = scenarios.find(([name]) => name === sample)
  if (!entry) throw new Error(`Unknown sample ${sample}`)
  const originalSrj = structuredClone(entry[1])
  const inputSha256 = createHash("sha256")
    .update(JSON.stringify(originalSrj))
    .digest("hex")
  const result: Result = {
    sample,
    inputSha256,
    solved: false,
    timedOut: false,
    elapsedTimeMs: 0,
  }
  const start = performance.now()
  try {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      originalSrj,
      {
        effort,
        cacheProvider: null,
        enableRepair04: mode === "candidate",
      } as ConstructorParameters<
        typeof AutoroutingPipelineSolver9_PreloadedTraceGraph
      >[1],
    )
    let captured = false
    let capturedRepair04 = false
    let evaluateStageRoutes:
      | ((routes: HighDensityRoute[]) => ReturnType<typeof evaluate>)
      | undefined
    let previousPhase = ""
    while (!solver.solved && !solver.failed) {
      const phase = solver.getCurrentPhase()
      if (phase !== previousPhase) {
        console.log(
          `${sample} ${phase} ${Math.round(performance.now() - start)}ms`,
        )
        previousPhase = phase
      }
      solver.step()
      if (!captured && solver.globalDrcForceImproveSolver?.solved) {
        // Capture the immutable state immediately after repair03, before repair04
        // is constructed. Do not call a downstream stage's constructor factory.
        const captureAccess = solver as unknown as {
          getSrjWithMaterializedPreloadedTraces(): SimpleRouteJson
          getPreloadedTraceUpdatesAfterHighDensity(): {
            updatedPreloadedTraces: SimplifiedPcbTrace[]
            mutatedPreloadedTraces: SimplifiedPcbTrace[]
          }
        }
        const srj = captureAccess.getSrjWithMaterializedPreloadedTraces()
        const updates = captureAccess.getPreloadedTraceUpdatesAfterHighDensity()
        if (!solver.netToPointPairsSolver)
          throw new Error("Repair03 completed without point pairs")
        const params = {
          srj,
          srjWithPointPairs: srj,
          originalSrj: solver.originalSrj,
          updatedPreloadedTraces: updates.updatedPreloadedTraces,
          mutatedPreloadedTraceIds: new Set(
            updates.mutatedPreloadedTraces.map((trace) => trace.pcb_trace_id),
          ),
          layerCount: solver.srj.layerCount,
          defaultViaDiameter: solver.viaDiameter,
          defaultViaHoleDiameter: solver.viaHoleDiameter,
          connMap: solver.connMap,
          newConnections: solver.netToPointPairsSolver.newConnections,
          obstacles: solver.srj.obstacles,
        }
        const hdRoutes =
          solver.globalDrcForceImproveSolver.getOutput() as HighDensityRoute[]
        const newTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
          ...params,
          hdRoutes,
          connections: params.newConnections,
          originalConnections: params.srj.connections,
        })
        const mutatedPreloadedTraces = params.updatedPreloadedTraces.filter(
          (trace) => params.mutatedPreloadedTraceIds.has(trace.pcb_trace_id),
        )
        evaluateStageRoutes = (
          routes: HighDensityRoute[],
        ): ReturnType<typeof evaluate> => {
          const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
            ...params,
            hdRoutes: routes,
            connections: params.newConnections,
            originalConnections: params.srj.connections,
          })
          return evaluate(
            params.originalSrj,
            params.srjWithPointPairs,
            preparePipeline9DrcRoutedTraces({
              originalPreloadedTraces: params.originalSrj.traces ?? [],
              mutatedPreloadedTraces,
              newTraces: traces,
            }),
          )
        }
        const routedTraces = preparePipeline9DrcRoutedTraces({
          originalPreloadedTraces: params.originalSrj.traces ?? [],
          mutatedPreloadedTraces,
          newTraces,
        })
        const postRepair03 = evaluate(
          params.originalSrj,
          params.srjWithPointPairs,
          routedTraces,
        )
        result.postRepair03RelaxedErrors = postRepair03.relaxedErrors
        result.postRepair03StrictErrors = postRepair03.strictErrors
        await writeFile(
          resolve(outDir, `${sample}.post-repair03.json`),
          JSON.stringify({
            datasetCommit: DATASET_COMMIT,
            inputSha256,
            originalSrj: params.originalSrj,
            srj: params.srj,
            srjWithPointPairs: params.srjWithPointPairs,
            hdRoutes,
            pipelineSrj: solver.srj,
            newConnections: params.newConnections,
            updatedPreloadedTraces: params.updatedPreloadedTraces,
            mutatedPreloadedTraceIds: [...params.mutatedPreloadedTraceIds],
            layerCount: params.layerCount,
            defaultViaDiameter: params.defaultViaDiameter,
            defaultViaHoleDiameter: params.defaultViaHoleDiameter,
            ...postRepair03,
          }),
        )
        captured = true
      }
      if (!capturedRepair04 && solver.repair04Solver?.solved) {
        if (!evaluateStageRoutes)
          throw new Error("Repair04 completed before repair03 capture")
        const after = evaluateStageRoutes(solver.repair04Solver.getOutput())
        result.postRepair04RelaxedErrors = after.relaxedErrors
        result.postRepair04StrictErrors = after.strictErrors
        result.repair04Stats = solver.repair04Solver.stats
        capturedRepair04 = true
      }
      if (performance.now() - start > timeoutMs) {
        result.timedOut = true
        result.error = `Timeout after ${timeoutMs}ms in ${solver.getCurrentPhase()}`
        break
      }
    }
    result.solved = solver.solved
    result.stageTiming = solver.timeSpentOnPhase
    if (solver.failed)
      result.error = solver.error ?? "Pipeline failed without error"
    if (solver.solved) {
      if (!solver.srjWithPointPairs)
        throw new Error("Solved pipeline has no point pairs")
      Object.assign(
        result,
        evaluate(
          originalSrj,
          solver.srjWithPointPairs,
          solver.getOutputSimplifiedPcbTraces(),
        ),
      )
      await writeFile(
        resolve(outDir, `${sample}.output.json`),
        JSON.stringify(solver.getOutputSimpleRouteJson()),
      )
    }
  } catch (error) {
    result.solved = false
    result.error =
      error instanceof Error ? (error.stack ?? error.message) : String(error)
  }
  result.elapsedTimeMs = performance.now() - start
  await writeFile(
    resolve(outDir, `${sample}.result.json`),
    JSON.stringify(result, null, 2),
  )
  console.log(
    JSON.stringify({
      sample,
      solved: result.solved,
      postRepair03Errors: result.postRepair03RelaxedErrors?.length,
      relaxedErrors: result.relaxedErrors?.length,
      strictErrors: result.strictErrors?.length,
      elapsedTimeMs: result.elapsedTimeMs,
      error: result.error,
    }),
  )
}

const workerSample = option("--worker", "")
if (workerSample) {
  await runWorker(workerSample)
} else {
  const revisionProcess = Bun.spawn(["git", "rev-parse", "HEAD"], {
    stdout: "pipe",
  })
  const revision = (await new Response(revisionProcess.stdout).text()).trim()
  await revisionProcess.exited
  await writeFile(
    resolve(outDir, "configuration.json"),
    JSON.stringify(
      {
        datasetCommit: DATASET_COMMIT,
        samples: EXPECTED_SAMPLE_IDS,
        denominator: 37,
        mode,
        revision,
        effort,
        concurrency,
        timeoutMs,
        bunVersion: Bun.version,
        relaxed: { traceClearance: 0.1, viaClearance: 0.1 },
        strict:
          "getDrcErrors(circuitJson) library defaults; identical conversion to relaxed",
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
  const requested = option("--samples", "").split(",").filter(Boolean)
  for (const sample of requested) {
    if (!EXPECTED_SAMPLE_IDS.includes(sample))
      throw new Error(`Unknown sample ${sample}`)
  }
  const queue = scenarios.filter(
    ([name]) => requested.length === 0 || requested.includes(name),
  )
  const results: Result[] = []
  let saving = Promise.resolve()
  await Promise.all(
    Array.from({ length: concurrency }, async (): Promise<void> => {
      while (queue.length > 0) {
        const [sample, srj] = queue.shift()!
        const child = Bun.spawn(
          [
            process.execPath,
            import.meta.path,
            "--worker",
            sample,
            "--mode",
            mode,
            "--out-dir",
            outDir,
            "--effort",
            String(effort),
            "--timeout-ms",
            String(timeoutMs),
          ],
          { stdout: "inherit", stderr: "inherit" },
        )
        const killTimer = setTimeout(
          () => child.kill("SIGKILL"),
          timeoutMs + 60000,
        )
        const code = await child.exited
        clearTimeout(killTimer)
        let result: Result
        if (code === 0) {
          result = JSON.parse(
            await readFile(resolve(outDir, `${sample}.result.json`), "utf8"),
          )
        } else {
          result = {
            sample,
            inputSha256: createHash("sha256")
              .update(JSON.stringify(srj))
              .digest("hex"),
            solved: false,
            timedOut: code === 137,
            elapsedTimeMs: timeoutMs,
            error: `Worker exited with code ${code}`,
          }
          await writeFile(
            resolve(outDir, `${sample}.result.json`),
            JSON.stringify(result, null, 2),
          )
        }
        results.push(result)
        const ordered = [...results].sort(
          (a, b) =>
            EXPECTED_SAMPLE_IDS.indexOf(a.sample) -
            EXPECTED_SAMPLE_IDS.indexOf(b.sample),
        )
        const summary = JSON.stringify(
          {
            datasetCommit: DATASET_COMMIT,
            mode,
            denominator: 37,
            evaluated: ordered.length,
            complete: ordered.length === 37,
            solved: ordered.filter((r) => r.solved).length,
            relaxedPassed: ordered.filter(
              (r) => r.solved && r.relaxedErrors?.length === 0,
            ).length,
            strictPassed: ordered.filter(
              (r) => r.solved && r.strictErrors?.length === 0,
            ).length,
            postRepair03RelaxedPassed: ordered.filter(
              (r) => r.postRepair03RelaxedErrors?.length === 0,
            ).length,
            results: ordered,
          },
          null,
          2,
        )
        saving = saving.then(() =>
          writeFile(resolve(outDir, "summary.json"), summary),
        )
        await saving
      }
    }),
  )
  await saving
}
