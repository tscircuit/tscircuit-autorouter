import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"

type CooperativePipelineProbeOptions = {
  stepCount: number
  failAt?: number
  throwAt?: number
}

export class CooperativePipelineProbe extends AutoroutingPipelineSolver9_PreloadedTraceGraph {
  private readonly options: CooperativePipelineProbeOptions

  constructor(options: CooperativePipelineProbeOptions) {
    super({
      layerCount: 2,
      minTraceWidth: 0.1,
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      obstacles: [],
      connections: [],
    })
    this.options = options
    this.MAX_ITERATIONS = options.stepCount
  }

  override _step(): void {
    if (this.iterations === this.options.throwAt) {
      throw new Error("Probe step failed")
    }
    if (this.iterations === this.options.failAt) {
      this.failed = true
      this.error = "Probe could not route"
      return
    }
    this.solved = this.iterations === this.options.stepCount
  }
}
