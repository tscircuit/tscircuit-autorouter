import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { AutoroutingPipelineSolver7_MultiGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { loadScenarios } from "./scenarios"

const outputDir =
  process.env.CONGESTION_BENCHMARK_OUT ?? "/tmp/congestion-srj18"
mkdirSync(outputDir, { recursive: true })
const scenarios = await loadScenarios("srj18", { effort: 1 })
const timeoutMs = Number(process.env.CONGESTION_BENCHMARK_TIMEOUT_MS ?? 600_000)
const selectedSamples =
  process.env.CONGESTION_BENCHMARK_SAMPLES?.split(",").map(Number)
const pathingOnly = process.env.CONGESTION_BENCHMARK_PATHING_ONLY === "1"
const childSample = process.argv.indexOf("--child")
if (childSample >= 0) {
  const index = Number(process.argv[childSample + 1])
  const variant = process.argv[childSample + 2]
  const [name, input] = scenarios[index]
  const file = join(outputDir, `${name}-${variant}.json`)
  const result: Record<string, unknown> = {
    name,
    variant,
    effort: 1,
    timeout: false,
    solved: false,
    relaxedDrcPassed: false,
  }
  const start = performance.now()
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(input),
    { effort: 1 },
  )
  const stage = solver.pipelineDef.find(
    (s) => s.solverName === "portPointPathingSolver",
  )!
  const getParams = stage.getConstructorParams
  stage.getConstructorParams = (pipeline): any => {
    const params = getParams(pipeline) as any
    params[0].flags.USE_CONGESTION_REROUTING = variant === "new"
    return params
  }
  let capturedPathing = false
  try {
    while (!solver.solved && !solver.failed) {
      if (performance.now() - start > timeoutMs) {
        result.timeout = true
        break
      }
      solver.step()
      if (!capturedPathing && solver.portPointPathingSolver?.solved) {
        capturedPathing = true
        const pathing = solver.portPointPathingSolver
        const tiny =
          pathing.congestionReroutingSolver?.getOutput() ??
          (pathing as any).tinyPipelineSolver.getSolvedTinySolver()
        let connectedRoutes = 0
        for (let routeId = 0; routeId < tiny.problem.routeCount; routeId++) {
          const adjacency = new Map<number, Set<number>>()
          for (
            let regionId = 0;
            regionId < tiny.topology.regionCount;
            regionId++
          ) {
            for (const [owner, a, b] of tiny.state.regionSegments[regionId]) {
              if (owner !== routeId) continue
              if (
                !tiny.topology.incidentPortRegion[a].includes(regionId) ||
                !tiny.topology.incidentPortRegion[b].includes(regionId)
              ) {
                throw new Error(
                  `Invalid region assignment for route ${routeId}`,
                )
              }
              if (!adjacency.has(a)) adjacency.set(a, new Set())
              if (!adjacency.has(b)) adjacency.set(b, new Set())
              adjacency.get(a)!.add(b)
              adjacency.get(b)!.add(a)
            }
          }
          const visited = new Set<number>()
          const pending = [tiny.problem.routeStartPort[routeId]]
          while (pending.length) {
            const port = pending.pop()!
            if (visited.has(port)) continue
            visited.add(port)
            for (const neighbor of adjacency.get(port) ?? [])
              pending.push(neighbor)
          }
          if (!visited.has(tiny.problem.routeEndPort[routeId]))
            throw new Error(`Disconnected route ${routeId}`)
          connectedRoutes++
        }
        const pfEntries = [...pathing.computeNodePfMap()].filter(
          (entry): entry is [string, number] => entry[1] !== null,
        )
        const pfValues = pfEntries.map(([, pf]) => pf)
        result.pathing = {
          connectedRoutes,
          routeCount: tiny.problem.routeCount,
          elapsedMs: performance.now() - start,
          phaseMs: solver.timeSpentOnPhase.portPointPathingSolver,
          maxPf: Math.max(0, ...pfValues),
          sumPf: pfValues.reduce((a, b) => a + b, 0),
          squaredPfSum: pfValues.reduce((a, b) => a + b * b, 0),
          nodeCount: pfValues.length,
          hotNodes: pfValues.filter((pf) => pf > 0.5).length,
          pfByNode: Object.fromEntries(pfEntries),
          rerouting: pathing.congestionReroutingSolver?.stats ?? null,
        }
        writeFileSync(file, JSON.stringify(result, null, 2))
        if (pathingOnly) break
      }
    }
    result.solveMs = performance.now() - start
    result.solved = solver.solved && !solver.failed
    result.phase = solver.getCurrentPhase()
    result.error = solver.error
    if (result.solved) {
      const { errors } = evaluateRelaxedDrc({
        inputSrj: input,
        srjWithPointPairs: solver.srjWithPointPairs!,
        routedTraces: solver.getOutputSimplifiedPcbTraces(),
      })
      result.drcErrorCount = errors.length
      result.relaxedDrcPassed = errors.length === 0
    }
  } catch (error) {
    result.error = String(error)
    result.phase = solver.getCurrentPhase()
    result.solveMs = performance.now() - start
  }
  result.totalMs = performance.now() - start
  writeFileSync(file, JSON.stringify(result, null, 2))
} else {
  const selectedVariants = process.env.CONGESTION_BENCHMARK_VARIANT
  const tasks = scenarios.flatMap((_, index) =>
    (index % 2 === 0 ? ["baseline", "new"] : ["new", "baseline"]).map(
      (variant) => ({ index, variant }),
    ),
  )
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const { index, variant } = tasks[next++]
      if (selectedVariants && variant !== selectedVariants) continue
      if (selectedSamples && !selectedSamples.includes(index + 1)) continue
      const name = scenarios[index][0]
      const log = Bun.file(join(outputDir, `${name}-${variant}.log`))
      const process = Bun.spawn(
        ["bun", import.meta.path, "--child", String(index), variant],
        { stdout: log, stderr: log },
      )
      const timer = setTimeout(() => process.kill(), timeoutMs + 30_000)
      const code = await process.exited
      clearTimeout(timer)
      const file = join(outputDir, `${name}-${variant}.json`)
      if (code !== 0) {
        let partial: Record<string, unknown> = {}
        try {
          partial = JSON.parse(readFileSync(file, "utf8"))
        } catch {}
        writeFileSync(
          file,
          JSON.stringify(
            {
              ...partial,
              name,
              variant,
              error: `child exit ${code}`,
              timeout: code === 137 || code === 143,
              solved: false,
              relaxedDrcPassed: false,
            },
            null,
            2,
          ),
        )
      }
      const result = JSON.parse(readFileSync(file, "utf8"))
      console.log(
        JSON.stringify({
          name,
          variant,
          solved: result.solved,
          drc: result.drcErrorCount,
          maxPf: result.pathing?.maxPf,
          accepted: result.pathing?.rerouting?.accepted,
          solveMs: result.solveMs,
          error: result.error,
        }),
      )
    }
  }
  console.log(
    JSON.stringify({
      dataset: "srj18",
      samples: scenarios.length,
      effort: 1,
      workers: 4,
      timeoutMs,
    }),
  )
  await Promise.all(Array.from({ length: 4 }, worker))
  const rows = tasks
    .filter(
      (task) =>
        (!selectedVariants || task.variant === selectedVariants) &&
        (!selectedSamples || selectedSamples.includes(task.index + 1)),
    )
    .map(({ index, variant }) =>
      JSON.parse(
        readFileSync(
          join(outputDir, `${scenarios[index][0]}-${variant}.json`),
          "utf8",
        ),
      ),
    )
  writeFileSync(
    join(outputDir, "results.json"),
    JSON.stringify(
      {
        dataset: "srj18",
        effort: 1,
        samples: scenarios.length,
        pathingOnly,
        timeoutMs,
        rows,
      },
      null,
      2,
    ),
  )
}
