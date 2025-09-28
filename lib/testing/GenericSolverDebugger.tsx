import { useState, useEffect, useMemo, useRef } from "react"
import {
  InteractiveGraphics,
  InteractiveGraphicsCanvas,
} from "graphics-debug/react"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { combineVisualizations } from "lib/utils/combineVisualizations"

interface GenericSolverDebuggerProps {
  createSolver: () => BaseSolver
  animationSpeed?: number
  onSolverStarted?: (solver: BaseSolver) => void
  onSolverCompleted?: (solver: BaseSolver) => void
}

export const GenericSolverDebugger = ({
  createSolver,
  animationSpeed = 10,
  onSolverStarted,
  onSolverCompleted,
}: GenericSolverDebuggerProps) => {
  const [mainSolver, setMainSolver] = useState<BaseSolver>(() => createSolver())
  const [previewMode, setPreviewMode] = useState(false)
  const [objectSelectionEnabled, setObjectSelectionEnabled] = useState(false)
  const [forcedUpdates, setForceUpdate] = useState(0)
  const [isAnimating, setIsAnimating] = useState(false)
  const [speedLevel, setSpeedLevel] = useState(0)
  const [showDeepestVisualization, setShowDeepestVisualization] =
    useState(false)
  const [selectedSolverKey, setSelectedSolverKey] = useState<"main" | number>(
    "main",
  )
  const [renderer, setRenderer] = useState<"canvas" | "vector">(
    window.localStorage.getItem("lastRenderer") === "vector"
      ? "vector"
      : "canvas",
  )
  const [lastTargetIteration, setLastTargetIteration] = useState<number>(
    parseInt(window.localStorage.getItem("lastTargetIteration") || "0", 10),
  )
  const [selectedStatKey, setSelectedStatKey] = useState<string | null>(
    window.localStorage.getItem("lastSelectedStatKey") || null,
  )
  const [showStatSelectionDialog, setShowStatSelectionDialog] = useState(false)

  const selectedSolver = useMemo(() => {
    if (selectedSolverKey === "main") {
      return mainSolver
    } else if (
      mainSolver.failedSubSolvers &&
      mainSolver.failedSubSolvers.length > selectedSolverKey
    ) {
      return mainSolver.failedSubSolvers[selectedSolverKey]
    }
  }, [mainSolver, selectedSolverKey])

  const speedLevels = [1, 2, 5, 10, 100, 500, 1000, 2000]
  const speedLabels = [
    "1x",
    "2x",
    "5x",
    "10x",
    "100x",
    "500x",
    "1000x",
    "2000x",
  ]

  // Reset solver
  const resetSolver = () => {
    setMainSolver(createSolver())
    setSelectedSolverKey("main")
    setSelectedStatKey(null)
  }

  const stats = useRef({
    bestF: Infinity,
    bestCandidateIteration: 0,
    lastF: Infinity,
    lastG: Infinity,
    lastH: Infinity,
  })

  const stepWithStats = () => {
    const nextCandidate =
      (mainSolver as any).lastCandidate || (mainSolver as any).candidates?.[0]
    if (nextCandidate) {
      if (nextCandidate.f < stats.current.bestF) {
        stats.current.bestF = nextCandidate.f
        stats.current.bestCandidateIteration = mainSolver.iterations
      }
      stats.current.lastF = nextCandidate.f
      stats.current.lastG = nextCandidate.g
      stats.current.lastH = nextCandidate.h
    }
    mainSolver.step()
  }

  // Animation effect
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined

    if (isAnimating && !mainSolver.solved && !mainSolver.failed) {
      intervalId = setInterval(() => {
        const stepsPerInterval = speedLevels[speedLevel]

        for (let i = 0; i < stepsPerInterval; i++) {
          if (mainSolver.solved || mainSolver.failed) {
            break
          }
          stepWithStats()
        }
        setForceUpdate((prev) => prev + 1)
      }, animationSpeed)
    }

    return () => {
      if (intervalId !== undefined) {
        clearInterval(intervalId)
      }
    }
  }, [isAnimating, speedLevel, mainSolver, animationSpeed])

  // Manual step function
  const handleStep = () => {
    if (!mainSolver.solved && !mainSolver.failed) {
      stepWithStats()
      setForceUpdate((prev) => prev + 1)
    }
  }

  // Step until selected stat changes
  const handleStepStat = () => {
    if (!selectedStatKey) {
      setShowStatSelectionDialog(true)
      return
    }

    if (mainSolver.solved || mainSolver.failed) {
      return
    }

    const initialStatValue = mainSolver.stats[selectedStatKey]
    let safetyBreak = 0
    const MAX_STEPS_PER_CLICK = 5000 // Safety break

    while (
      !mainSolver.solved &&
      !mainSolver.failed &&
      safetyBreak < MAX_STEPS_PER_CLICK
    ) {
      stepWithStats()
      safetyBreak++
      // Check if the stat exists and has changed
      if (
        mainSolver.stats.hasOwnProperty(selectedStatKey) &&
        mainSolver.stats[selectedStatKey] !== initialStatValue
      ) {
        break
      }
    }

    if (safetyBreak >= MAX_STEPS_PER_CLICK) {
      console.warn(
        `Step Stat: Reached max steps (${MAX_STEPS_PER_CLICK}) without detecting a change in stat "${selectedStatKey}".`,
      )
    }

    setForceUpdate((prev) => prev + 1)
  }

  // Substep function for deepest active subsolver
  const handleSubStep = () => {
    let deepestSolver = mainSolver.activeSubSolver
    while (deepestSolver?.activeSubSolver) {
      deepestSolver = deepestSolver.activeSubSolver
    }

    if (deepestSolver && !deepestSolver.solved && !deepestSolver.failed) {
      deepestSolver.step()
      setForceUpdate((prev) => prev + 1)
    }
  }

  // Next Stage function
  const handleNextStage = () => {
    if (!mainSolver.solved && !mainSolver.failed) {
      const initialSubSolver = mainSolver.activeSubSolver

      // Step until we get a new subsolver (null -> something)
      if (initialSubSolver === null) {
        while (
          !mainSolver.solved &&
          !mainSolver.failed &&
          mainSolver.activeSubSolver === null
        ) {
          mainSolver.step()
        }
      }

      // Now step until the subsolver completes (something -> null)
      if (mainSolver.activeSubSolver !== null) {
        while (
          !mainSolver.solved &&
          !mainSolver.failed &&
          mainSolver.activeSubSolver !== null
        ) {
          mainSolver.step()
        }
      }

      setForceUpdate((prev) => prev + 1)
    }
  }

  // Solve completely
  const handleSolveCompletely = () => {
    if (!mainSolver.solved && !mainSolver.failed) {
      if (onSolverStarted) {
        onSolverStarted(mainSolver)
      }
      mainSolver.solve()
      setForceUpdate((prev) => prev + 1)
    }
  }

  // Go to specific iteration
  const handleGoToIteration = () => {
    if (mainSolver.solved || mainSolver.failed) {
      return
    }

    const targetIterationStr = window.prompt(
      "Enter target iteration number:",
      lastTargetIteration.toString(),
    )

    if (targetIterationStr === null) {
      return // User canceled the dialog
    }

    const targetIterations = parseInt(targetIterationStr, 10)

    if (Number.isNaN(targetIterations) || targetIterations < 0) {
      alert("Please enter a valid positive number")
      return
    }

    setLastTargetIteration(targetIterations)
    window.localStorage.setItem(
      "lastTargetIteration",
      targetIterations.toString(),
    )

    // If we're already past the target, we need to reset and start over
    if (mainSolver.iterations > targetIterations) {
      const newSolver = createSolver()
      setMainSolver(newSolver)

      // Now run until we reach the target
      while (
        newSolver.iterations < targetIterations &&
        !newSolver.solved &&
        !newSolver.failed
      ) {
        newSolver.step()
      }
    } else {
      // We just need to run until we reach the target
      while (
        mainSolver.iterations < targetIterations &&
        !mainSolver.solved &&
        !mainSolver.failed
      ) {
        mainSolver.step()
      }
    }

    setForceUpdate((prev) => prev + 1)
  }

  useEffect(() => {
    if (
      (mainSolver.solved || mainSolver.failed) &&
      onSolverCompleted &&
      mainSolver.iterations > 0
    ) {
      onSolverCompleted(mainSolver)
    }
  }, [mainSolver.iterations])

  // Increase animation speed
  const increaseSpeed = () => {
    setSpeedLevel((prev) => Math.min(prev + 1, speedLevels.length - 1))
    if (!isAnimating) {
      setIsAnimating(true)
    }
  }

  // Decrease animation speed
  const decreaseSpeed = () => {
    setSpeedLevel((prev) => Math.max(prev - 1, 0))
  }

  let deepestActiveSubSolver = mainSolver.activeSubSolver
  while (deepestActiveSubSolver?.activeSubSolver) {
    deepestActiveSubSolver = deepestActiveSubSolver.activeSubSolver
  }

  // Safely get visualization
  const visualization = useMemo(() => {
    try {
      if (showDeepestVisualization && deepestActiveSubSolver) {
        return previewMode
          ? deepestActiveSubSolver.preview() || { points: [], lines: [] }
          : deepestActiveSubSolver.visualize() || { points: [], lines: [] }
      }

      if (previewMode) {
        return selectedSolver?.preview() || { points: [], lines: [] }
      }
      return selectedSolver?.visualize() || { points: [], lines: [] }
    } catch (error) {
      console.error("Visualization error:", error)
      return { points: [], lines: [] }
    }
  }, [
    forcedUpdates,
    selectedSolver,
    previewMode,
    showDeepestVisualization,
    deepestActiveSubSolver,
  ])

  // Generate solver options for dropdown
  const solverOptions = useMemo(() => {
    const options = [
      {
        value: "main" as string | number,
        label: `Main Solver (${mainSolver.constructor.name})`,
      },
    ]

    if (mainSolver.failedSubSolvers && mainSolver.failedSubSolvers.length > 0) {
      mainSolver.failedSubSolvers.forEach((subSolver, index) => {
        options.push({
          value: index,
          label: `Failed Solver ${index + 1} (${subSolver.constructor.name})`,
        })
      })
    }

    return options
  }, [forcedUpdates, mainSolver, mainSolver.failedSubSolvers?.length])

  return (
    <div className="p-4">
      <div className="flex gap-2 mb-4">
        <button
          className="border rounded-md p-2 hover:bg-gray-100"
          onClick={handleStep}
          disabled={mainSolver.solved || mainSolver.failed}
        >
          Step
        </button>
        <button
          className="border rounded-md p-2 hover:bg-gray-100"
          onClick={handleStepStat}
          disabled={mainSolver.solved || mainSolver.failed}
          title={
            selectedStatKey
              ? `Step until stat "${selectedStatKey}" changes`
              : "Step until selected stat changes"
          }
        >
          Step Stat {selectedStatKey ? `(${selectedStatKey})` : ""}
        </button>
        {showDeepestVisualization && (
          <button
            className="border rounded-md p-2 hover:bg-gray-100"
            onClick={handleSubStep}
            disabled={
              !deepestActiveSubSolver || mainSolver.solved || mainSolver.failed
            }
          >
            Substep
          </button>
        )}
        <button
          className="border rounded-md p-2 hover:bg-gray-100"
          onClick={handleNextStage}
          disabled={mainSolver.solved || mainSolver.failed}
        >
          Next Stage
        </button>
        <button
          className="border rounded-md p-2 hover:bg-gray-100"
          onClick={() => setIsAnimating(!isAnimating)}
          disabled={mainSolver.solved || mainSolver.failed}
        >
          {isAnimating ? "Stop" : "Animate"}
        </button>
        <button
          className="border rounded-md p-2 hover:bg-gray-100"
          onClick={decreaseSpeed}
          disabled={speedLevel === 0 || mainSolver.solved || mainSolver.failed}
        >
          Slower
        </button>
        <button
          className="border rounded-md p-2 hover:bg-gray-100 min-w-[80px]"
          onClick={increaseSpeed}
          disabled={
            speedLevel === speedLevels.length - 1 ||
            mainSolver.solved ||
            mainSolver.failed
          }
        >
          {speedLabels[speedLevel + 1] ?? "(Max)"}
        </button>
        <button
          className="border rounded-md p-2 hover:bg-gray-100"
          onClick={handleSolveCompletely}
          disabled={mainSolver.solved || mainSolver.failed}
        >
          Solve Completely
        </button>
        <button
          className="border rounded-md p-2 hover:bg-gray-100"
          onClick={resetSolver}
        >
          Reset
        </button>
        <button
          className="border rounded-md p-2 hover:bg-gray-100"
          onClick={() => setObjectSelectionEnabled(!objectSelectionEnabled)}
        >
          {objectSelectionEnabled ? "Disable" : "Enable"} Object Selection
        </button>
        <button
          className="border rounded-md p-2 hover:bg-gray-100"
          onClick={() => {
            setRenderer(renderer === "canvas" ? "vector" : "canvas")
            window.localStorage.setItem(
              "lastRenderer",
              renderer === "canvas" ? "vector" : "canvas",
            )
          }}
        >
          Switch to {renderer === "canvas" ? "Vector" : "Canvas"} Renderer
        </button>
      </div>

      <div className="flex gap-4 mb-4 tabular-nums">
        <div className="border p-2 rounded flex items-center">
          Iterations:{" "}
          <span className="font-bold ml-1">{mainSolver.iterations}</span>
          <button
            className="ml-2 border rounded-md px-2 py-1 text-sm hover:bg-gray-100"
            onClick={handleGoToIteration}
            disabled={mainSolver.solved || mainSolver.failed}
            title={
              lastTargetIteration > 0
                ? `Last: ${lastTargetIteration}`
                : "Go to specific iteration"
            }
          >
            Go to Iteration
          </button>
        </div>
        <div className="border p-2 rounded flex items-center">
          Status:{" "}
          <span
            className={`font-bold ${mainSolver.solved ? "text-green-600" : mainSolver.failed ? "text-red-600" : "text-blue-600"}`}
          >
            {mainSolver.solved
              ? "Solved"
              : mainSolver.failed
                ? "Failed"
                : "No Errors"}
          </span>
        </div>
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
        {mainSolver.activeSubSolver && (
          <div className="border p-2 rounded">
            Active Stage:{" "}
            <span className="font-bold">
              {mainSolver.activeSubSolver.constructor.name}
            </span>
          </div>
        )}
        {mainSolver.timeToSolve !== undefined && (
          <div className="border p-2 rounded">
            Time to solve:{" "}
            <span className="font-bold">
              {(mainSolver.timeToSolve / 1000).toFixed(3)}s
            </span>
          </div>
        )}
        {solverOptions.length > 1 && (
          <div>
            <select
              className="border rounded-md p-2 w-full max-w-md"
              value={selectedSolverKey.toString()}
              onChange={(e) =>
                setSelectedSolverKey(
                  e.target.value === "main" ? "main" : parseInt(e.target.value),
                )
              }
            >
              {solverOptions.map((option) => (
                <option
                  key={option.value.toString()}
                  value={option.value.toString()}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {mainSolver.error && (
          <div className="border p-2 rounded bg-red-100">
            Error: <span className="font-bold">{mainSolver.error}</span>
          </div>
        )}
        {mainSolver.error && (
          <div className="border p-2 rounded bg-red-100">
            Error: <span className="font-bold">{mainSolver.error}</span>
          </div>
        )}
      </div>

      {showStatSelectionDialog && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex justify-center items-center">
          <div className="bg-white p-5 rounded-lg shadow-xl">
            <h3 className="text-lg font-medium leading-6 text-gray-900 mb-4">
              Select Stat to Watch
            </h3>
            <select
              className="border rounded-md p-2 w-full mb-4"
              value={selectedStatKey || ""}
              onChange={(e) => {
                const newKey = e.target.value || null
                setSelectedStatKey(newKey)
                if (newKey) {
                  window.localStorage.setItem("lastSelectedStatKey", newKey)
                } else {
                  window.localStorage.removeItem("lastSelectedStatKey")
                }
              }}
            >
              <option value="">-- Select a Stat --</option>
              {Object.keys(mainSolver.stats).map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                className="border rounded-md px-4 py-2 bg-gray-200 hover:bg-gray-300"
                onClick={() => setShowStatSelectionDialog(false)}
              >
                Cancel
              </button>
              <button
                className="border rounded-md px-4 py-2 bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                onClick={() => {
                  setShowStatSelectionDialog(false)
                  // Optionally trigger the first step immediately after selection
                  if (selectedStatKey) {
                    handleStepStat() // Call handleStepStat again now that a key is selected
                  }
                }}
                disabled={!selectedStatKey}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="border rounded-md p-4 mb-4">
        {objectSelectionEnabled || renderer === "vector" ? (
          <InteractiveGraphics graphics={visualization} />
        ) : (
          <InteractiveGraphicsCanvas
            graphics={visualization}
            showLabelsByDefault={false}
          />
        )}
      </div>

      <div className="mt-4 border-t pt-4">
        <h3 className="font-bold mb-2">Solver Information</h3>
        <div className="flex">
          <div>
            <div className="border p-2 rounded mb-2">
              Type:{" "}
              <span className="font-bold">
                {selectedSolver?.constructor.name}
              </span>
            </div>
            <div className="border p-2 rounded mb-2">
              Max Iterations:{" "}
              <span className="font-bold">
                {selectedSolver?.MAX_ITERATIONS}
              </span>
            </div>
            {selectedSolver?.stats &&
              Object.keys(selectedSolver?.stats).length > 0 && (
                <div className="border p-2 rounded mb-2">
                  <details>
                    <summary>Stats</summary>
                    <pre>
                      {JSON.stringify(selectedSolver?.stats, null, "  ")}
                    </pre>
                  </details>
                </div>
              )}
            {selectedSolver?.cacheKey && (
              <div className="border p-2 rounded mb-2 whitespace-pre">
                Cache Key: {selectedSolver.cacheKey as string}
              </div>
            )}
            {(selectedSolver as any)?.candidates !== undefined && (
              <div className="border p-2 rounded mb-2 flex flex-wrap space-x-4 [&>*]:w-36">
                <div>
                  Candidates:{" "}
                  <span className="font-bold">
                    {(selectedSolver as any).candidates?.length ?? 0}
                  </span>
                </div>
                <div>
                  Best F:{" "}
                  <span className="font-bold">
                    {stats.current.bestF.toFixed(3)}
                  </span>
                </div>
                <div>
                  Best F:{" "}
                  <span className="font-bold">
                    {stats.current.bestCandidateIteration}
                  </span>
                </div>
                <div>
                  Last F:{" "}
                  <span className="font-bold">
                    {stats.current.lastF?.toFixed(3)}
                  </span>
                </div>
                <div>
                  Last G:{" "}
                  <span className="font-bold">
                    {stats.current.lastG?.toFixed(3)}
                  </span>
                </div>
                <div>
                  Last H:{" "}
                  <span className="font-bold">
                    {stats.current.lastH?.toFixed(3)}
                  </span>
                </div>
              </div>
            )}
          </div>
          <div>
            <table>
              <tbody>
                {Object.entries(mainSolver.stats).map(([k, v]) => {
                  return (
                    <tr key={k}>
                      <td className="p-1">{k}</td>
                      <td className="p-1">{JSON.stringify(v)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div>
        <h3 className="font-bold mb-2">Advanced</h3>
        <div className="flex gap-2">
          <button onClick={() => setPreviewMode(!previewMode)}>
            {previewMode ? "Disable" : "Enable"} Preview Mode
          </button>
          {mainSolver.activeSubSolver && (
            <button
              className="border rounded-md p-2 hover:bg-gray-100"
              onClick={() => {
                if (!deepestActiveSubSolver) {
                  window.alert("No active sub solver found")
                  return
                }

                let params: any
                try {
                  params = deepestActiveSubSolver.getConstructorParams()
                } catch (e: any) {
                  window.alert(
                    `Unable to get constructor params: ${e.toString()}`,
                  )
                  return
                }

                const paramsJson = JSON.stringify(params, null, 2)
                const blob = new Blob([paramsJson], {
                  type: "application/json",
                })
                const url = URL.createObjectURL(blob)
                const a = document.createElement("a")
                a.download = `${deepestActiveSubSolver.constructor.name}_input.json`
                a.href = url
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                URL.revokeObjectURL(url)
              }}
            >
              Download Active Sub Solver Input (
              {deepestActiveSubSolver?.constructor?.name})
            </button>
          )}
          <button
            className="border rounded-md p-2 hover:bg-gray-100"
            onClick={() => {
              const vizJson = JSON.stringify(visualization, null, 2)
              const blob = new Blob([vizJson], { type: "application/json" })
              const url = URL.createObjectURL(blob)
              const a = document.createElement("a")
              a.download = "visualization.json"
              a.href = url
              document.body.appendChild(a)
              a.click()
              document.body.removeChild(a)
              URL.revokeObjectURL(url)
            }}
          >
            Download Visualization JSON
          </button>
        </div>
      </div>
    </div>
  )
}
