import { InteractiveGraphics } from "graphics-debug/react"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import ex from "examples/legacy/assets/highdensity21.json"
import { HighDensityDebugger } from "lib/testing/HighDensityDebugger"
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"

export default () => <HyperHighDensityDebugger {...ex} />
