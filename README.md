# @tscircuit/capacity-autorouter

An MIT-licensed full-pipeline PCB autorouter for node.js and TypeScript projects. Part of [tscircuit](https://github.com/tscircuit/tscircuit)

[View Online Playground](https://autorouter.tscircuit.com) &middot; [tscircuit docs](https://docs.tscircuit.com) &middot; [discord](https://tscircuit.com/join) &middot; [twitter](https://x.com/seveibar) &middot; [try tscircuit online](https://tscircuit.com) &middot; [Report/Debug Autorouter Bugs](https://docs.tscircuit.com/contributing/report-autorouter-bugs)

Want to understand how the autorouter works? Read this [blog post](https://blog.autorouting.com/p/hypergraph-autorouting)

## How to file a bug report

1. You should have [created a bug report via the tscircuit errors tab](https://docs.tscircuit.com/contributing/report-autorouter-bugs)
2. Run `bun run bug-report <bug-report-url>` to download the report and create a debugging fixture file in the `examples/bug-reports` directory, you can then find the bug report in the server (via `bun run start`)
3. Or run `bun run bug-report-with-test <bug-report-url>` to download the report, create the fixture, and scaffold a matching snapshot test under `tests/bugs`

Or [run the Create Bug Report workflow](https://github.com/tscircuit/capacity-autorouter/actions/workflows/create-bug-report.yml) to automatically create a PR with the bug report (maintainers only)

## Installation

```bash
bun add @tscircuit/capacity-autorouter
```

This `rust-experiment` branch ports selected routing and repair modules to Rust WASM through the existing synchronous solver API. The package embeds its WASM binaries and initializes them during solver construction; consumers do not fetch assets, call an initializer, or select a backend. Substantial TypeScript stages remain. See the [experiment scope, measurements, and validation](docs/rust-port/README.md).

## Usage as a Library

### Basic Usage

```typescript
import { AutoroutingPipelineSolver } from "@tscircuit/capacity-autorouter"

// Create a solver with SimpleRouteJson input
const solver = new AutoroutingPipelineSolver(simpleRouteJson)

// Run the solver until completion
while (!solver.solved && !solver.failed) {
  solver.step()
}

// Check if solving was successful
if (solver.failed) {
  console.error("Routing failed:", solver.error)
} else {
  // Get the routing results as SimpleRouteJson with traces
  const resultWithRoutes = solver.getOutputSimpleRouteJson()

  // Use the resulting routes in your application
  console.log(
    `Successfully routed ${resultWithRoutes.traces?.length} connections`
  )
}
```

### Simplifying Existing Traces

Use `AutoroutingPipelineSolver11_Simplification` when the input already
contains routed traces and only needs post-route cleanup. This pipeline does
not route missing SRJ connections. Constant-width traces are simplified while
variable-width traces retain their exact copper widths and geometry.

```typescript
import { AutoroutingPipelineSolver11_Simplification } from "@tscircuit/capacity-autorouter"

const solver = new AutoroutingPipelineSolver11_Simplification(simpleRouteJson)
solver.solve()

if (solver.failed) {
  throw new Error(solver.error ?? "Trace simplification failed")
}

const simplified = solver.getOutputSimpleRouteJson()
```

### Input Format: SimpleRouteJson

The input to the autorouter is a `SimpleRouteJson` object with the following structure:

```typescript
interface SimpleRouteJson {
  layerCount: number
  minTraceWidth: number
  obstacles: Obstacle[]
  connections: Array<SimpleRouteConnection>
  buses?: Array<SimpleRouteBus>
  allowViaInPad?: boolean
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  traces?: SimplifiedPcbTraces // Optional for input
}

interface Obstacle {
  type: "rect"
  layers: string[]
  center: { x: number; y: number }
  width: number
  height: number
  ccwRotationDegrees?: number
  connectedTo: string[] // TraceIds
  isCopperPour?: boolean
  offBoardConnectsTo?: string[] // TraceIds connected off-board
}

interface SimpleRouteConnection {
  name: string
  pointsToConnect: Array<SingleLayerConnectionPoint | MultiLayerConnectionPoint>
}

type SingleLayerConnectionPoint = {
  x: number
  y: number
  layer: string
  layers?: never
}

type MultiLayerConnectionPoint = {
  x: number
  y: number
  layers: string[]
  layer?: never
}

interface SimpleRouteBus {
  busId: string
  connectionNames: string[] // Ordered SimpleRouteConnection names
  maxLengthSkew?: number // Maximum routed-length difference in millimeters
  traceWidth?: number // Resolved copper width in millimeters
  allowedLayers?: string[] // Legal routing layers, including terminal layers
}

interface DifferentialPair {
  connectionNames: [string, string]
  lengthTolerance: number // Maximum pair skew in millimeters
  traceGap?: number // Resolved edge-to-edge copper gap in millimeters
  maxUncoupledLength?: number // Maximum uncoupled length in millimeters
}
```

Connection points use exactly one representation: `layer` for a fixed routing
layer, or `layers` for a terminal accessible on multiple routing layers. Never
include both fields. The optional `never` properties enforce this distinction
in TypeScript; they are not JSON fields to emit. For multilayer points, the first
entry is the primary layer. Obstacle and via `layers` arrays describe their
physical copper span and are separate from the connection-point representation.

`maxLengthSkew` records the maximum permitted routed-length difference for the
bus. Bus metadata is preserved in the output so routing implementations can
apply the constraint without losing the original membership or ordering.
`traceWidth`, `traceGap`, and `allowedLayers` are resolved routing geometry;
stackup-aware impedance targets should be converted to these dimensions before
creating SimpleRouteJson.

Via-in-pad repair is disabled by default because it generally requires filled
and capped vias. Set `allowViaInPad: true` only when the fabrication process
supports it.

### Output Format

The `getOutputSimpleRouteJson()` method returns the original `SimpleRouteJson` with a populated `traces` property. The traces are represented as `SimplifiedPcbTraces`:

```typescript
type SimplifiedPcbTraces = Array<{
  type: "pcb_trace"
  pcb_trace_id: string // TraceId
  route: Array<
    | {
        route_type: "wire"
        x: number
        y: number
        width: number
        layer: string
      }
    | {
        route_type: "via"
        x: number
        y: number
        to_layer: string
        from_layer: string
      }
  >
}>
```

### Advanced Configuration

You can provide optional configuration parameters to the solver:

```typescript
const solver = new CapacityMeshSolver(simpleRouteJson, {
  // Optional: Manually set capacity planning depth (otherwise automatically calculated)
  capacityDepth: 7,

  // Optional: Set the target minimum capacity for automatic depth calculation
  // Lower values result in finer subdivisions (higher depth)
  targetMinCapacity: 0.5,
})
```

By default, the solver will automatically calculate the optimal `capacityDepth` to achieve a target minimum capacity of 0.5 based on the board dimensions. This automatic calculation ensures that the smallest subdivision cells have an appropriate capacity for routing.

### Visualization Support

For debugging or interactive applications, you can use the `visualize()` method to get a visualization of the current routing state:

```typescript
// Get visualization data that can be rendered with graphics-debug
const visualization = solver.visualize()
```

## Development

To work on this library:

```bash
# Install dependencies
bun install

# Generate required WASM imports before source tests or development
bun run build:bindings

# Start the interactive development environment
bun run start

# Run tests
bun test

# Build the library
bun run build
```

Install Rust with the `wasm32-unknown-unknown` target and `wasm-bindgen-cli` 0.2.128 before generating assets. CI pins Rust 1.98.1. The generated imports are ignored by Git, so a fresh checkout needs `bun run build:bindings` after dependency installation and before source tests, type checks, benchmarks, or the dev server.

`bun run build` requires that same tooling. It builds and embeds WASM before producing the package. After that, `bun run build:ts` rebuilds only JavaScript and declarations.

Parity comparisons use a separate frozen TypeScript checkout with independently installed dependencies, selected by `TSCIRCUIT_TS_REFERENCE`. It is a development reference, never a production backend. See [Rust integration and validation](rust/autorouter-bindings/README.md).

## Maintainer resources

Track routing performance and benchmark results in the [Autorouter Benchmark Dashboard](https://autorouter-benchmark-dashboard.vercel.app/).

### DRC failure dataset (SRJ33)

[dataset-srj33-drc-failures](https://github.com/tscircuit/dataset-srj33-drc-failures)
contains 37 distinct inputs with at least one measured Pipeline 9 relaxed DRC
issue. The [original benchmark](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/33978041068)
retained 12 samples and excluded 19 DRC passes. An
[additional audit](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/33980539076)
added 25 bug-report inputs that completed routing with DRC issues after the
recent DRC fix. Original IDs remain 001–006, 010–013, 020, and 025; additions use
032–056.

```sh
bun scripts/run-sample.ts --pipeline 9 --dataset srj33 --sample 1
```

Use `srj33` in the benchmark workflow's dataset input, or open
`benchmarks/dataset-srj33` in Cosmos. CLI `--sample` selects by position:
`--sample 12` loads `sample025`, and `--sample 37` loads `sample056`.
Cosmos uses the sample IDs. The dataset records source links, pinned revisions,
and Pipeline 9 selection evidence. Saved outputs for the original 12 are their
historical Pipeline 7 baseline; additions include Pipeline 9 outputs and exact
DRC errors.
