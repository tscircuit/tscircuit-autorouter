import {
  PostProcessingSolver,
  type DifferentialPair,
  type PostProcessingSolverOutput,
  type PostProcessingSolverParams,
} from "@tscircuit/length-matching-solver"
import type { GraphicsObject } from "graphics-debug"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimplifiedPcbTrace } from "lib/types/srj-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getObstaclesFromSrjTraces } from "lib/utils/convertSrjTracesToObstacles"
import { BaseSolver } from "./BaseSolver"

/** Keep adjoining segments as connected copper while tuning each pair. */
export class DifferentialPairSegmentPostProcessingSolver extends BaseSolver {
  private readonly batches: DifferentialPair[][]
  private routes: HighDensityRoute[]
  private batchIndex = 0
  private solver?: PostProcessingSolver
  private readonly preservedNames = new Set<string>()
  private output?: PostProcessingSolverOutput

  constructor(private readonly params: PostProcessingSolverParams) {
    super()
    this.routes = params.hdRoutes
    const pairedNames = new Set(params.differentialPairs.flatMap(
      (pair): string[] => pair.connectionNames,
    ))
    const roots = params.hdRoutes.filter(
      (route): boolean => pairedNames.has(route.connectionName),
    ).map((route): string => route.rootConnectionName ?? route.connectionName)
    const hasSharedRoots = new Set(roots).size !== roots.length
    this.batches = hasSharedRoots ? params.differentialPairs.map(
      (pair): DifferentialPair[] => [pair],
    ) : [params.differentialPairs]
    this.MAX_ITERATIONS = 1
  }

  override getConstructorParams(): [PostProcessingSolverParams] {
    return [this.params]
  }

  override _step(): void {
    const pairs = this.batches[this.batchIndex]!
    if (!this.solver) {
      const names = new Set(pairs.flatMap((pair): string[] => pair.connectionNames))
      const roots = new Set(this.routes.filter(
        (route): boolean => names.has(route.connectionName),
      ).map((route): string => route.rootConnectionName ?? route.connectionName))
      const siblings = this.routes.filter((route): boolean =>
        !names.has(route.connectionName) && roots.has(route.rootConnectionName ?? route.connectionName),
      )
      const siblingNames = new Set(siblings.map((route): string => route.connectionName))
      this.preservedNames.clear()
      for (const name of siblingNames) this.preservedNames.add(name)
      const connectedCopper = siblings.length === 0 ? [] : getObstaclesFromSrjTraces({
        layerCount: this.params.layerCount,
        minTraceWidth: siblings[0]!.traceThickness,
        bounds: this.params.bounds,
        connections: [],
        obstacles: [],
        traces: siblings.map((route): SimplifiedPcbTrace => {
          if (route.jumpers?.length)
            throw new Error(`Differential pair segment "${route.connectionName}" has unsupported adjoining jumper copper`)
          return {
            type: "pcb_trace",
            pcb_trace_id: route.connectionName,
            connection_name: route.connectionName,
            connectsTo: [route.rootConnectionName ?? route.connectionName],
            route: convertHdRouteToSimplifiedRoute(route, this.params.layerCount),
          }
        }),
      })
      this.solver = new PostProcessingSolver({
        ...this.params,
        hdRoutes: this.routes.filter((route): boolean => !siblingNames.has(route.connectionName)),
        differentialPairs: pairs,
        obstacles: [...this.params.obstacles, ...connectedCopper],
      })
      this.MAX_ITERATIONS += this.solver.MAX_ITERATIONS + 1
    }
    this.solver.step()
    if (this.solver.failed)
      throw new Error(`Differential pair segment post-processing failed: ${this.solver.error}`)
    if (!this.solver.solved) return
    const output = this.solver.getOutput()
    if (this.batches.length > 1 && output.postProcessingErrors.length > 0)
      throw new Error(`Differential pair segment post-processing failed: ${output.postProcessingErrors.map(
        (error): string => error.message,
      ).join("; ")}`)
    const replacements = new Map(output.hdRoutes.map(
      (route): [string, HighDensityRoute] => [route.connectionName, route],
    ))
    this.routes = this.routes.map((route): HighDensityRoute => {
      if (this.preservedNames.has(route.connectionName)) return route
      const replacement = replacements.get(route.connectionName)
      if (!replacement)
        throw new Error(`Differential pair post-processing lost route "${route.connectionName}"`)
      return replacement
    })
    this.batchIndex++
    if (this.batchIndex === this.batches.length) {
      this.output = { ...output, hdRoutes: this.routes }
      this.solved = true
    } else {
      this.solver = undefined
    }
  }

  getOutput(): PostProcessingSolverOutput {
    if (!this.solved || !this.output)
      throw new Error("Differential pair segment output requested before completion")
    return this.output
  }

  override visualize(): GraphicsObject {
    return this.solver ? this.solver.visualize() : super.visualize()
  }
}
