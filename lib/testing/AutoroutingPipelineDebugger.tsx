import { useState, useEffect, useMemo, useRef } from "react"
import {
  InteractiveGraphics,
  InteractiveGraphicsCanvas,
} from "graphics-debug/react"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { SimpleRouteJson } from "lib/types"
import {
  AutoroutingPipelineSolver,
  CapacityMeshSolver,
} from "lib/solvers/AutoroutingPipelineSolver"
import { GraphicsObject, Line, Point, Rect } from "graphics-debug"
import { limitVisualizations } from "lib/utils/limitVisualizations"
import { getNodesNearNode } from "lib/solvers/UnravelSolver/getNodesNearNode"
import { filterUnravelMultiSectionInput } from "./utils/filterUnravelMultiSectionInput"
import { convertToCircuitJson } from "./utils/convertToCircuitJson"
import { getDrcErrors } from "./getDrcErrors"
import { addVisualizationToLastStep } from "lib/utils/addVisualizationToLastStep"
import { SolveBreakpointDialog } from "./SolveBreakpointDialog"
import { CacheDebugger } from "./CacheDebugger"
import {
  getGlobalInMemoryCache,
  getGlobalLocalStorageCache,
} from "lib/cache/setupGlobalCaches"
import { CacheProvider } from "lib/cache/types"
import { AutoroutingPipelineMenuBar } from "./AutoroutingPipelineMenuBar"

interface CapacityMeshPipelineDebuggerProps {
  srj: SimpleRouteJson
  animationSpeed?: number
  createSolver?: (
    srj: SimpleRouteJson,
    opts: { cacheProvider?: CacheProvider | null },
  ) => any
}

export const SPEED_DEFINITIONS = [
  { label: "1s / step", delay: 1000, steps: 1 },
  { label: "500ms / step", delay: 500, steps: 1 },
  { label: "100ms / step", delay: 100, steps: 1 },
  { label: "50ms / step", delay: 50, steps: 1 },
  { label: "1x", delay: 1, steps: 1 },
  { label: "2x", delay: 1, steps: 2 },
  { label: "5x", delay: 1, steps: 5 },
  { label: "10x", delay: 1, steps: 10 },
  { label: "100x", delay: 1, steps: 100 },
  { label: "500x", delay: 1, steps: 500 },
  { label: "5000x", delay: 1, steps: 5000 },
]

export const cacheProviderNames = [
  "None",
  "In Memory",
  "Local Storage",
] as const
export type CacheProviderName = (typeof cacheProviderNames)[number]

const getGlobalCacheProviderFromName = (
  name: CacheProviderName,
): CacheProvider | null => {
  if (name === "None") return null
  if (name === "In Memory") return getGlobalInMemoryCache()
  if (name === "Local Storage") return getGlobalLocalStorageCache()
  return null
}

export const AutoroutingPipelineDebugger = ({
  srj,
  animationSpeed = 1,
  createSolver: createSolverProp,
}: CapacityMeshPipelineDebuggerProps) => {
  const [cacheProviderName, setCacheProviderNameState] =
    useState<CacheProviderName>(
      (localStorage.getItem("cacheProviderName") as CacheProviderName) ??
        "None",
    )

  const setCacheProviderName = (newName: CacheProviderName) => {
    setCacheProviderNameState(newName)
    localStorage.setItem("cacheProviderName", newName)
  }

  const cacheProvider = useMemo(
    () => getGlobalCacheProviderFromName(cacheProviderName),
    [cacheProviderName],
  )

  const createNewSolver = (
    opts: { cacheProvider?: CacheProvider | null } = {},
  ) =>
    createSolverProp
      ? createSolverProp(srj, { cacheProvider, ...opts })
      : new AutoroutingPipelineSolver(srj, {
          cacheProvider,
          ...opts,
        })

  const [solver, setSolver] = useState<CapacityMeshSolver>(() =>
    createNewSolver(),
  )
  const [previewMode, setPreviewMode] = useState(false)
  const [renderer, setRenderer] = useState<"canvas" | "vector">(
    (window.localStorage.getItem("lastSelectedRenderer") as
      | "canvas"
      | "vector") ?? "vector",
  )
  const [canSelectObjects, setCanSelectObjects] = useState(false)
  const [, setForceUpdate] = useState(0)
  const [isAnimating, setIsAnimating] = useState(false)
  const [speedLevel, setSpeedLevel] = useState(4)
  const [solveTime, setSolveTime] = useState<number | null>(null)
  const [dialogObject, setDialogObject] = useState<Rect | null>(null)
  const [lastTargetIteration, setLastTargetIteration] = useState<number>(
    parseInt(window.localStorage.getItem("lastTargetIteration") || "0", 10),
  )
  const [drcErrors, setDrcErrors] = useState<GraphicsObject | null>(null)
  const [drcErrorCount, setDrcErrorCount] = useState<number>(0)
  const [showDeepestVisualization, setShowDeepestVisualization] =
    useState(false)
  const [isBreakpointDialogOpen, setIsBreakpointDialogOpen] = useState(false)
  const [breakpointNodeId, setBreakpointNodeId] = useState<string>(
    () => window.localStorage.getItem("lastBreakpointNodeId") || "",
  )
  const isSolvingToBreakpointRef = useRef(false) // Ref to track breakpoint solving state

  // Reset solver
  const resetSolver = () => {
    setSolver(createNewSolver())
    setDrcErrors(null) // Clear DRC errors when resetting
    setDrcErrorCount(0)
    isSolvingToBreakpointRef.current = false // Stop breakpoint solving on reset
  }

  // Animation effect
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined

    if (isAnimating && !solver.solved && !solver.failed) {
      const speedDef = SPEED_DEFINITIONS[speedLevel]
      // For speeds >= 1x (index 4+), we might still want to respect the passed-in animationSpeed prop
      // but for slow speeds, we must enforce the delay
      const delay = speedLevel < 4 ? speedDef.delay : animationSpeed

      intervalId = setInterval(() => {
        const stepsPerInterval = speedDef.steps

        for (let i = 0; i < stepsPerInterval; i++) {
          if (solver.solved || solver.failed) {
            break
          }
          solver.step()
        }
        setForceUpdate((prev) => prev + 1)
      }, delay)
    }

    return () => {
      if (intervalId !== undefined) {
        clearInterval(intervalId)
      }
    }

    // Stop animation if breakpoint solving is active
    if (isSolvingToBreakpointRef.current) {
      setIsAnimating(false)
    }
  }, [isAnimating, speedLevel, solver, animationSpeed])

  // Manual step function
  const handleStep = () => {
    if (!solver.solved && !solver.failed) {
      solver.step()
      setForceUpdate((prev) => prev + 1)
    }
    isSolvingToBreakpointRef.current = false // Stop breakpoint solving on manual step
  }

  // Next Stage function
  const handleNextStage = () => {
    if (!solver.solved && !solver.failed) {
      const initialSubSolver = solver.activeSubSolver

      // Step until we get a new subsolver (null -> something)
      if (initialSubSolver === null) {
        while (
          !solver.solved &&
          !solver.failed &&
          solver.activeSubSolver === null
        ) {
          solver.step()
        }
      }

      // Now step until the subsolver completes (something -> null)
      if (solver.activeSubSolver !== null) {
        while (
          !solver.solved &&
          !solver.failed &&
          solver.activeSubSolver !== null
        ) {
          solver.step()
        }
      }

      setForceUpdate((prev) => prev + 1)
    }
    isSolvingToBreakpointRef.current = false // Stop breakpoint solving on next stage
  }

  // Solve completely
  const handleSolveCompletely = () => {
    if (!solver.solved && !solver.failed) {
      const startTime = performance.now() / 1000
      solver.solve()
      const endTime = performance.now() / 1000
      setSolveTime(endTime - startTime)
    }
    isSolvingToBreakpointRef.current = false // Stop breakpoint solving on solve completely
  }

  // Go to specific iteration
  const handleGoToIteration = () => {
    const targetIteration = window.prompt(
      "Enter target iteration number:",
      lastTargetIteration.toString(),
    )

    if (targetIteration === null) {
      return // User canceled the dialog
    }

    const target = parseInt(targetIteration, 10)

    if (Number.isNaN(target) || target < 0) {
      alert("Please enter a valid positive number")
      return
    }

    setLastTargetIteration(target)
    window.localStorage.setItem("lastTargetIteration", target.toString())

    // If we're already past the target, we need to reset and start over
    if (solver.iterations > target) {
      const newSolver = createNewSolver()
      setSolver(newSolver)

      // Now run until we reach the target
      while (
        newSolver.iterations < target &&
        !newSolver.solved &&
        !newSolver.failed
      ) {
        newSolver.step()
      }
    } else {
      // We just need to run until we reach the target
      while (solver.iterations < target && !solver.solved && !solver.failed) {
        solver.step()
      }
    }

    setForceUpdate((prev) => prev + 1)
    isSolvingToBreakpointRef.current = false // Stop breakpoint solving on go to iteration
  }

  // Run DRC checks on the current routes
  const handleRunDrcChecks = () => {
    try {
      // Get the SRJ with point pairs from the NetToPointPairsSolver
      const srjWithPointPairs =
        solver.netToPointPairsSolver?.getNewSimpleRouteJson() ||
        solver.srjWithPointPairs

      if (!srjWithPointPairs) {
        alert(
          "No connection information available. Wait until the NetToPointPairsSolver completes.",
        )
        return
      }

      const routes: any = solver?.getOutputSimplifiedPcbTraces()

      // Neither available, show error
      if (!routes) {
        alert(
          "No routes available yet. Complete routing first or proceed to high-density routing stage.",
        )
        return
      }

      // Convert to circuit-json format with both connection information and routes
      const circuitJson = convertToCircuitJson(
        srjWithPointPairs,
        routes,
        solver.srj.minTraceWidth,
      )

      const { errors: allErrors, locationAwareErrors } =
        getDrcErrors(circuitJson)

      if (allErrors.length > 0) {
        const errorGraphics: GraphicsObject = {
          circles: locationAwareErrors.map((error) => ({
            center: error.center,
            radius: 0.75,
            fill: "rgba(255, 0, 0, 0.3)",
            layer: "drc",
            stroke: "red",
            strokeWidth: 0.1,
            label: error.message,
          })),
          points: locationAwareErrors.map((error) => ({
            x: error.center.x,
            y: error.center.y,
            color: "red",
            size: 10,
            layer: "drc",
            label: error.message,
          })),
          // Cross markers at error points for better visibility
          lines: locationAwareErrors.flatMap((error) => [
            {
              points: [
                { x: error.center.x - 0.5, y: error.center.y - 0.5 },
                { x: error.center.x - 0.4, y: error.center.y - 0.4 },
              ],
              layer: "drc",
              strokeColor: "red",
              strokeWidth: 0.05,
            },
            {
              points: [
                { x: error.center.x + 0.5, y: error.center.y + 0.5 },
                { x: error.center.x + 0.4, y: error.center.y + 0.4 },
              ],
              layer: "drc",
              strokeColor: "red",
              strokeWidth: 0.05,
            },
            {
              points: [
                { x: error.center.x - 0.5, y: error.center.y + 0.5 },
                { x: error.center.x - 0.4, y: error.center.y + 0.4 },
              ],
              strokeColor: "red",
              strokeWidth: 0.05,
            },
            {
              points: [
                { x: error.center.x + 0.5, y: error.center.y - 0.5 },
                { x: error.center.x + 0.4, y: error.center.y - 0.4 },
              ],
              layer: "drc",
              strokeColor: "red",
              strokeWidth: 0.05,
            },
          ]),
        }

        setDrcErrors(errorGraphics)
        setDrcErrorCount(allErrors.length)
        alert(
          `Found ${allErrors.length} DRC errors. See the highlighted areas.`,
        )
      } else {
        setDrcErrors(null)
        setDrcErrorCount(0)
        alert("No DRC errors found! All traces are properly spaced.")
      }
    } catch (error) {
      console.error("DRC check error:", error)
      alert(
        `Error running DRC checks: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  // Solve to Breakpoint logic
  const handleSolveToBreakpoint = (
    targetSolverName: string,
    targetNodeId: string,
  ) => {
    if (solver.solved || solver.failed || isSolvingToBreakpointRef.current) {
      return
    }

    setBreakpointNodeId(targetNodeId)
    window.localStorage.setItem("lastBreakpointNodeId", targetNodeId)
    isSolvingToBreakpointRef.current = true
    setIsAnimating(false) // Ensure regular animation is stopped

    const checkBreakpoint = () => {
      if (!isSolvingToBreakpointRef.current) return // Stop if cancelled

      let deepestSolver = solver.activeSubSolver
      while (deepestSolver?.activeSubSolver) {
        deepestSolver = deepestSolver.activeSubSolver
      }

      if (deepestSolver) {
        const solverName = deepestSolver.constructor.name
        let rootNodeId: string | undefined = undefined
        try {
          // Attempt to get rootNodeId, specific to certain solvers like UnravelSectionSolver
          const params = (deepestSolver as any).getConstructorParams()
          if (params?.rootNodeId) {
            rootNodeId = params.rootNodeId
          } else if (params?.[0]?.rootNodeId) {
            // Handle cases where params are wrapped in an array
            rootNodeId = params[0].rootNodeId
          }
        } catch (e) {
          // Ignore errors if getConstructorParams or rootNodeId doesn't exist
        }

        console.log(solverName, rootNodeId)
        if (solverName === targetSolverName && rootNodeId === targetNodeId) {
          console.log(
            `Breakpoint hit: ${targetSolverName} with rootNodeId ${targetNodeId}`,
          )
          isSolvingToBreakpointRef.current = false // Breakpoint hit, stop solving
          setForceUpdate((prev) => prev + 1) // Update UI
          return
        }
      }

      // If breakpoint not hit, take a step
      if (!solver.solved && !solver.failed) {
        solver.step()
        setForceUpdate((prev) => prev + 1) // Update UI after step
        requestAnimationFrame(checkBreakpoint) // Continue checking in the next frame
      } else {
        isSolvingToBreakpointRef.current = false // Solver finished or failed
      }
    }

    requestAnimationFrame(checkBreakpoint) // Start the checking loop
  }

  // Play until a specific stage
  const handlePlayStage = (targetSolverStageKey: string) => {
    if (solver.solved || solver.failed) return

    // Stop any ongoing animation or breakpoint solving
    setIsAnimating(false)
    isSolvingToBreakpointRef.current = false

    // Step until the target solver becomes active
    while (
      !solver.solved &&
      !solver.failed &&
      solver.activeSubSolver?.constructor.name !== targetSolverStageKey
    ) {
      solver.step()
      // Check if the target solver became active *after* the step
      if (solver?.[targetSolverStageKey as keyof AutoroutingPipelineSolver]) {
        break
      }
    }

    setForceUpdate((prev) => prev + 1) // Update UI
  }

  // Increase animation speed
  const increaseSpeed = () => {
    setSpeedLevel((prev) => Math.min(prev + 1, SPEED_DEFINITIONS.length - 1))
    if (!isAnimating) {
      setIsAnimating(true)
    }
  }

  // Decrease animation speed
  const decreaseSpeed = () => {
    setSpeedLevel((prev) => Math.max(prev - 1, 0))
  }

  let deepestActiveSubSolver = solver.activeSubSolver
  while (deepestActiveSubSolver?.activeSubSolver) {
    deepestActiveSubSolver = deepestActiveSubSolver.activeSubSolver
  }

  // Safely get visualization
  const visualization = useMemo(() => {
    try {
      let baseVisualization: GraphicsObject

      if (showDeepestVisualization && deepestActiveSubSolver) {
        baseVisualization = previewMode
          ? deepestActiveSubSolver.preview() || { points: [], lines: [] }
          : deepestActiveSubSolver.visualize() || { points: [], lines: [] }
      } else if (previewMode) {
        baseVisualization = solver?.preview() || { points: [], lines: [] }
      } else {
        baseVisualization = solver?.visualize() || { points: [], lines: [] }
      }

      // If we have DRC errors, combine them with the base visualization
      if (drcErrors) {
        return addVisualizationToLastStep(baseVisualization, drcErrors)
      }

      return baseVisualization
    } catch (error) {
      console.error("Visualization error:", error)
      return { points: [], lines: [] }
    }
  }, [
    solver,
    solver.iterations,
    previewMode,
    drcErrors,
    showDeepestVisualization,
    deepestActiveSubSolver,
  ])

  return (
    <div className="p-4">
      <AutoroutingPipelineMenuBar
        renderer={renderer}
        onSetRenderer={(newRenderer) => {
          setRenderer(newRenderer)
          window.localStorage.setItem("lastSelectedRenderer", newRenderer)
        }}
        canSelectObjects={canSelectObjects}
        onSetCanSelectObjects={setCanSelectObjects}
        onRunDrcChecks={handleRunDrcChecks}
        drcErrorCount={drcErrorCount}
        animationSpeed={speedLevel}
        onSetAnimationSpeed={setSpeedLevel}
        onSolveToBreakpointClick={() => {
          setIsBreakpointDialogOpen(true)
        }}
        cacheProviderName={cacheProviderName}
        cacheProvider={cacheProvider}
        onSetCacheProviderName={(name: CacheProviderName) => {
          setCacheProviderName(name)
          setSolver(
            createNewSolver({
              cacheProvider: getGlobalCacheProviderFromName(name),
            }),
          )
        }}
        onClearCache={() => {
          cacheProvider?.clearCache()
        }}
      />
      <div className="flex gap-2 mb-4 text-xs">
        <button
          className="border rounded-md p-2 hover:bg-gray-100"
          onClick={handleStep}
          disabled={solver.solved || solver.failed}
        >
          Step
        </button>
        <button
          className="border rounded-md p-2 hover:bg-gray-100"
          onClick={handleNextStage}
          disabled={solver.solved || solver.failed}
        >
          Next Stage
        </button>
        <button
          className="border rounded-md p-2 hover:bg-gray-100"
          onClick={() => setIsAnimating(!isAnimating)}
          disabled={solver.solved || solver.failed}
        >
          {isAnimating ? "Stop" : "Animate"}
        </button>
        <button
          className="border rounded-md p-2 hover:bg-gray-100"
          onClick={handleSolveCompletely}
          disabled={solver.solved || solver.failed}
        >
          Solve Completely
        </button>
        <button
          className="border rounded-md p-2 hover:bg-gray-100"
          onClick={resetSolver}
        >
          Reset
        </button>
      </div>

      <div className="flex gap-4 mb-4 tabular-nums text-xs">
        <div className="border p-2 rounded flex items-center">
          Iterations:{" "}
          <span className="font-bold ml-1">{solver.iterations}</span>
          <button
            className="ml-2 rounded-md px-2 py-0 hover:bg-gray-100"
            onClick={handleGoToIteration}
            title={
              lastTargetIteration > 0
                ? `Last: ${lastTargetIteration}`
                : "Go to specific iteration"
            }
          >
            Go to Iteration
          </button>
        </div>
        <div className="border p-2 rounded">
          Status:{" "}
          <span
            className={`font-bold ${
              solver.solved
                ? "text-green-600"
                : solver.failed
                  ? "text-red-600"
                  : "text-blue-600"
            }`}
          >
            {solver.solved ? "Solved" : solver.failed ? "Failed" : "No Errors"}
          </span>
        </div>
        <div className="border p-2 rounded">
          Trace Count:{" "}
          <span className="font-bold">
            {solver.srjWithPointPairs?.connections.length ??
              `${solver.srj.connections.length} (*)`}
          </span>
        </div>
        {solveTime !== null && (
          <div className="border p-2 rounded">
            Time to Solve:{" "}
            <span className="font-bold">{solveTime.toFixed(3)}s</span>
          </div>
        )}
        <div className="border p-2 rounded">
          Active Stage:{" "}
          <span className="font-bold">
            {solver.activeSubSolver?.constructor.name ?? "None"}
          </span>
        </div>
        {solver.error && (
          <div className="border p-2 rounded bg-red-100">
            Error: <span className="font-bold">{solver.error}</span>
          </div>
        )}
        <div className="ml-2 flex items-center">
          <input
            type="checkbox"
            id="showDeepestVisualization"
            className="mr-1"
            checked={showDeepestVisualization}
            onChange={(e) => setShowDeepestVisualization(e.target.checked)}
          />
          <label htmlFor="showDeepestVisualization" className="text-sm">
            Deep Viz
          </label>
        </div>
      </div>

      <SolveBreakpointDialog
        isOpen={isBreakpointDialogOpen}
        onClose={() => setIsBreakpointDialogOpen(false)}
        onSolve={handleSolveToBreakpoint}
        initialNodeId={breakpointNodeId}
      />

      <div className="border rounded-md p-4 mb-4">
        {canSelectObjects || renderer === "vector" ? (
          <InteractiveGraphics
            graphics={visualization}
            onObjectClicked={({ object }) => {
              if (!canSelectObjects) return
              if (!object.label?.includes("cn")) return
              setDialogObject(object)
            }}
            objectLimit={20e3}
          />
        ) : (
          <InteractiveGraphicsCanvas
            graphics={visualization}
            showLabelsByDefault={false}
          />
        )}
      </div>

      {dialogObject && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-4 rounded-lg shadow-lg max-w-3xl max-h-[80vh] overflow-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg">
                Selected Object "{dialogObject.label?.split("\n")[0]}" (step{" "}
                {dialogObject.step})
              </h3>
              <button
                className="text-gray-500 hover:text-gray-700"
                onClick={() => setDialogObject(null)}
              >
                ✕
              </button>
            </div>
            <div>
              {dialogObject && (
                <div className="mb-4 flex flex-col">
                  <pre className="bg-gray-100 p-3 rounded overflow-auto max-h-96 text-sm">
                    {dialogObject.label}
                  </pre>
                  <button
                    className="mt-2 bg-blue-500 hover:bg-blue-600 text-white py-1 px-3 rounded text-sm"
                    onClick={() => {
                      if (dialogObject?.label) {
                        // Extract the capacity mesh node ID from the label
                        const match = dialogObject.label.match(/cn(\d+)/)
                        if (match?.[1]) {
                          const nodeId = `cn${parseInt(match[1], 10)}`

                          // Find the node in the solver's data
                          let nodeData = null

                          if (solver.nodeTargetMerger?.newNodes) {
                            nodeData = solver.nodeTargetMerger.newNodes.find(
                              (n: any) => n.capacityMeshNodeId === nodeId,
                            )
                          } else if (
                            solver.nodeSolver &&
                            "finishedNodes" in solver.nodeSolver
                          ) {
                            const finishedNodes = (solver.nodeSolver as any)
                              .finishedNodes as Array<any> | undefined
                            nodeData = finishedNodes?.find(
                              (n: any) => n.capacityMeshNodeId === nodeId,
                            )
                          }

                          // Get the node with port points from the segmentToPointOptimizer
                          let nodeWithPortPoints = null
                          if (
                            solver.unravelMultiSectionSolver
                              ?.getNodesWithPortPoints
                          ) {
                            nodeWithPortPoints = solver
                              .unravelMultiSectionSolver!.getNodesWithPortPoints()
                              .find((n) => n.capacityMeshNodeId === nodeId)
                          }

                          const dataToDownload = {
                            nodeId,
                            capacityMeshNode: nodeData,
                            nodeWithPortPoints: nodeWithPortPoints,
                          }

                          const dataStr = JSON.stringify(
                            dataToDownload,
                            null,
                            2,
                          )
                          const dataBlob = new Blob([dataStr], {
                            type: "application/json",
                          })
                          const url = URL.createObjectURL(dataBlob)
                          const a = document.createElement("a")
                          a.href = url
                          a.download = `${nodeId}-nodeWithPortPoints.json`
                          document.body.appendChild(a)
                          a.click()
                          document.body.removeChild(a)
                          URL.revokeObjectURL(url)
                        }
                      }
                    }}
                  >
                    Download High Density Node Input (NodeWithPortPoints)
                  </button>
                  <button
                    className="mt-2 bg-blue-500 hover:bg-blue-600 text-white py-1 px-3 rounded text-sm"
                    onClick={() => {
                      const match = dialogObject.label!.match(/cn(\d+)/)
                      const nodeId = `cn${parseInt(match![1], 10)}`
                      const umss = solver.unravelMultiSectionSolver
                      if (!umss) return
                      const verboseInput = {
                        dedupedSegments: umss.dedupedSegments,
                        dedupedSegmentMap: umss.dedupedSegmentMap,
                        nodeMap: umss.nodeMap,
                        nodeIdToSegmentIds: umss.nodeIdToSegmentIds,
                        segmentIdToNodeIds: umss.segmentIdToNodeIds,
                        colorMap: umss.colorMap,
                        rootNodeId: nodeId,
                        MUTABLE_HOPS: umss.MUTABLE_HOPS,
                        segmentPointMap: umss.segmentPointMap,
                        nodeToSegmentPointMap: umss.nodeToSegmentPointMap,
                        segmentToSegmentPointMap: umss.segmentToSegmentPointMap,
                      }

                      const relevantNodeIds = new Set(
                        getNodesNearNode({
                          nodeId,
                          nodeIdToSegmentIds: umss.nodeIdToSegmentIds,
                          segmentIdToNodeIds: umss.segmentIdToNodeIds,
                          hops: 8,
                        }),
                      )

                      // Filter the verbose input to only include content related to relevant nodes
                      const filteredVerboseInput =
                        filterUnravelMultiSectionInput(
                          verboseInput,
                          relevantNodeIds,
                        )

                      // Create a JSON string with proper formatting
                      const filteredInputJson = JSON.stringify(
                        filteredVerboseInput,
                        (key, value) => {
                          // Convert Maps to objects for JSON serialization
                          if (value instanceof Map) {
                            return Object.fromEntries(value)
                          }
                          return value
                        },
                        2,
                      )

                      // Create a blob with the JSON data
                      const blob = new Blob([filteredInputJson], {
                        type: "application/json",
                      })

                      // Create a URL for the blob
                      const url = URL.createObjectURL(blob)

                      // Create a temporary anchor element
                      const a = document.createElement("a")

                      // Set the download filename
                      a.download = `unravel_section_${nodeId}_input.json`
                      a.href = url

                      // Trigger the download
                      a.click()

                      // Clean up by revoking the URL
                      URL.revokeObjectURL(url)
                    }}
                  >
                    Download Unravel Section Input
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 border-t pt-4">
        <h3 className="font-bold mb-2">Pipeline Steps</h3>
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-100">
              <th className="border p-2 text-left">Step</th>
              <th className="border p-2 text-left">Status</th>
              <th className="border p-2 text-left">
                i<sub>0</sub>
              </th>
              <th className="border p-2 text-left">Iterations</th>
              <th className="border p-2 text-left">Progress</th>
              <th className="border p-2 text-left">Time</th>
              <th className="border p-2 text-left">Stats</th>
              <th className="border p-2 text-left">Input</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              let cumulativeIterations = 0

              // Calculate total time spent across all stages that have started
              const totalTimeMs =
                solver.pipelineDef?.reduce((total, step) => {
                  const startTime = solver.startTimeOfPhase[step.solverName]
                  if (startTime === undefined) return total // Stage hasn't started
                  const endTime =
                    solver.endTimeOfPhase[step.solverName] ?? performance.now()
                  return total + (endTime - startTime)
                }, 0) ?? 0

              return solver.pipelineDef?.map((step, index) => {
                const stepSolver = solver[
                  step.solverName as keyof CapacityMeshSolver
                ] as BaseSolver | undefined
                const i0 = cumulativeIterations
                if (stepSolver) {
                  cumulativeIterations += stepSolver.iterations
                }
                const status = stepSolver?.solved
                  ? "Solved"
                  : stepSolver?.failed
                    ? "Failed"
                    : stepSolver
                      ? "In Progress"
                      : "Not Started"
                const statusClass = stepSolver?.solved
                  ? "text-green-600"
                  : stepSolver?.failed
                    ? "text-red-600"
                    : "text-blue-600"

                const startTime = solver.startTimeOfPhase[step.solverName]
                const endTime =
                  solver.endTimeOfPhase[step.solverName] ?? performance.now()
                const stepTimeMs =
                  startTime !== undefined ? endTime - startTime : 0
                const stepTimeSec = stepTimeMs / 1000
                const timePercentage =
                  totalTimeMs > 0 ? (stepTimeMs / totalTimeMs) * 100 : 0

                return (
                  <tr key={step.solverName}>
                    <td className="border p-2">
                      <span className="text-gray-500 mr-1 tabular-nums">
                        {(index + 1).toString().padStart(2, "0")}
                      </span>
                      {status === "Not Started" && (
                        <button
                          className="ml-2 mr-2 text-xs hover:bg-gray-200 rounded px-1 py-0.5"
                          onClick={() =>
                            handlePlayStage(
                              solver.pipelineDef[index].solverName,
                            )
                          }
                          title={`Play until ${step.solverName} starts`}
                        >
                          ▶️
                        </button>
                      )}
                      {step.solverName}
                    </td>
                    <td className={`border p-2 font-bold ${statusClass}`}>
                      {status}
                    </td>
                    <td className="border p-2 tabular-nums text-gray-500">
                      {status === "Not Started" ? "" : i0}
                    </td>
                    <td className="border p-2">
                      {stepSolver?.iterations || 0}
                    </td>
                    <td className="border p-2">
                      {status === "Solved"
                        ? "100%"
                        : status === "In Progress"
                          ? `${((stepSolver?.progress ?? 0) * 100).toFixed(1)}%`
                          : ""}
                    </td>
                    <td className="border p-2 tabular-nums">
                      <div className="flex">
                        <div className="flex-grow">
                          {stepTimeSec.toFixed(2)}s
                        </div>
                        {status !== "Not Started" && totalTimeMs > 0 && (
                          <div className="text-gray-500 ml-1">
                            {timePercentage.toFixed(1)}%
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="border p-2 text-xs align-top">
                      {stepSolver?.stats &&
                      Object.keys(stepSolver.stats).length > 0 ? (
                        <details>
                          <summary className="cursor-pointer">Stats</summary>
                          <pre className="mt-1 bg-gray-50 p-1 rounded text-[10px] max-h-40 overflow-auto">
                            {JSON.stringify(stepSolver.stats, null, 2)}
                          </pre>
                        </details>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="border p-2">
                      <button
                        className="text-blue-600 hover:underline"
                        onClick={() => {
                          // Get the constructor parameters for this step
                          const params = step.getConstructorParams(solver)
                          // Recursively replace _parent: { ... } with _parent: { capacityMeshNodeId: "..." }
                          // This prevents circular references in the JSON
                          const replaceParent = (obj: any) => {
                            if (obj && typeof obj === "object") {
                              if (obj._parent) {
                                obj._parent = {
                                  capacityMeshNodeId:
                                    obj._parent.capacityMeshNodeId,
                                }
                              }

                              // Recursively process all properties
                              for (const key in obj) {
                                if (
                                  Object.prototype.hasOwnProperty.call(obj, key)
                                ) {
                                  replaceParent(obj[key])
                                }
                              }

                              // Handle arrays
                              if (Array.isArray(obj)) {
                                obj.forEach((item) => replaceParent(item))
                              }
                            }
                          }
                          replaceParent(params[0])

                          // Create a JSON string with proper formatting
                          const paramsJson = JSON.stringify(params, null, 2)
                          // Create a blob with the JSON data
                          const blob = new Blob([paramsJson], {
                            type: "application/json",
                          })
                          // Create a URL for the blob
                          const url = URL.createObjectURL(blob)
                          // Create a temporary anchor element
                          const a = document.createElement("a")
                          // Set the download filename to the solver name
                          a.download = `${step.solverName}_input.json`
                          a.href = url
                          // Trigger the download
                          a.click()
                          // Clean up by revoking the URL
                          URL.revokeObjectURL(url)
                        }}
                        disabled={!stepSolver}
                      >
                        ⬇️ Input
                      </button>
                    </td>
                  </tr>
                )
              })
            })()}
          </tbody>
        </table>
      </div>
      <h3 className="font-bold mt-8 mb-2">Advanced</h3>
      <div className="flex gap-2">
        <button onClick={() => setPreviewMode(!previewMode)}>
          {previewMode ? "Disable" : "Enable"} Preview Mode
        </button>
        <button
          onClick={() => {
            if (!deepestActiveSubSolver) {
              window.alert("No active sub solver found")
              return
            }
            let params: any
            try {
              params = deepestActiveSubSolver.getConstructorParams()
            } catch (e: any) {
              window.alert(`Unable to get constructor params: ${e.toString()}`)
            }

            if (typeof params === "object") {
              params = { ...params }
              for (const key in params) {
                if (params[key] instanceof Map) {
                  params[key] = Object.fromEntries(params[key])
                }
              }
            }

            const paramsJson = JSON.stringify(params, null, 2)
            const blob = new Blob([paramsJson], { type: "application/json" })
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = `${deepestActiveSubSolver.constructor.name}_input.json`
            a.click()
            URL.revokeObjectURL(url)
          }}
        >
          Download Active Sub Solver Input (
          {deepestActiveSubSolver?.constructor?.name})
        </button>
        <button
          onClick={() => {
            const circuitJson = convertToCircuitJson(
              solver.srjWithPointPairs!,
              solver.getOutputSimplifiedPcbTraces(),
              solver.srj.minTraceWidth,
            )
            const blob = new Blob([JSON.stringify(circuitJson, null, 2)], {
              type: "application/json",
            })
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = "circuit.json"
            a.click()
            URL.revokeObjectURL(url)
          }}
        >
          Download Circuit Json
        </button>
      </div>
      <CacheDebugger cacheProvider={cacheProvider} />
    </div>
  )
}
