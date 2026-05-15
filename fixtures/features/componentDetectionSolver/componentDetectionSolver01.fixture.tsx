import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import * as datasetSrj16 from "@tsci/tscircuit.dataset-srj16-bga-breakouts"
import { ComponentDetectionSolver } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import { SimpleRouteJson } from "lib/types"
import { useEffect, useState } from "react"

type DatasetCircuit = {
  id: string
  srj: SimpleRouteJson
}

type CircuitSelectorProps = {
  circuits: DatasetCircuit[]
  currentCircuit: DatasetCircuit
  currentIndex: number
  inputId: string
  onChange: (value: string) => void
}

/**
 * Checks whether a dataset sample looks like a usable SRJ object.
 * This keeps invalid exports out of the fixture UI.
 */
const isSimpleRouteJson = (value: unknown): value is SimpleRouteJson => {
  if (!value || typeof value !== "object") return false

  const candidate = value as Partial<SimpleRouteJson>
  return (
    typeof candidate.layerCount === "number" &&
    typeof candidate.minTraceWidth === "number" &&
    Array.isArray(candidate.obstacles) &&
    Array.isArray(candidate.connections) &&
    Boolean(candidate.bounds)
  )
}

/**
 * Normalizes free-form input into a zero-padded 3 digit circuit id.
 */
const normalizeCircuitId = (value: string) => {
  const digits = value.replace(/[^0-9]/g, "")
  if (digits.length === 0) return null
  return digits.padStart(3, "0").slice(-3)
}

const circuits = datasetSrj16.samples
  .map((sample): DatasetCircuit | null => {
    const sampleMatch = sample.sampleName.match(/^sample(\d{3})$/)
    if (!sampleMatch || !isSimpleRouteJson(sample.srj)) return null

    return {
      id: sampleMatch[1],
      srj: sample.srj,
    }
  })
  .filter((circuit): circuit is DatasetCircuit => circuit !== null)
  .sort((a, b) => Number(a.id) - Number(b.id))

/**
 * Reads the initial circuit from the URL and falls back to the first sample.
 */
const getInitialCircuitId = () => {
  const params = new URLSearchParams(window.location.search)
  const requested = normalizeCircuitId(params.get("circuit") ?? "")
  if (requested && circuits.some((entry) => entry.id === requested)) {
    return requested
  }

  if (circuits.length > 0) {
    return circuits[0].id
  }

  return ""
}

/**
 * Builds a quick lookup from circuit id to array index.
 */
const createCircuitIndexMap = () => {
  const map = new Map<string, number>()
  for (const [index, circuit] of circuits.entries()) {
    map.set(circuit.id, index)
  }
  return map
}

/** Displays the current validation error when one exists. */
const ErrorMessage = ({ error }: { error: string }) => {
  if (!error) {
    return null
  }

  return <div style={{ color: "red" }}>{error}</div>
}

/** Fallback UI when no valid circuit can be shown. */
const EmptyState = ({ error }: { error: string }) => {
  let errorMessage = null
  if (error) {
    errorMessage = <div style={{ color: "red", marginTop: 8 }}>{error}</div>
  }

  return (
    <div>
      <div>Unable to display a circuit.</div>
      {errorMessage}
    </div>
  )
}

/**
 * Simple numeric picker for moving through the srj16 dataset samples.
 */
const CircuitSelector = ({
  circuits,
  currentCircuit,
  currentIndex,
  inputId,
  onChange,
}: CircuitSelectorProps) => {
  let inputValue: number | string = ""
  if (inputId !== "") {
    inputValue = Number(inputId)
  }

  let minValue = 1
  if (circuits[0]) {
    minValue = Number(circuits[0].id)
  }

  let maxValue = 999
  if (circuits[circuits.length - 1]) {
    maxValue = Number(circuits[circuits.length - 1].id)
  }

  return (
    <div>
      <label>
        Circuit ID:{" "}
        <input
          type="number"
          min={minValue}
          max={maxValue}
          value={inputValue}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      </label>{" "}
      <span>
        (Current: {currentCircuit.id}, {currentIndex + 1} / {circuits.length})
      </span>
    </div>
  )
}

/**
 * Recreates the solver for the currently selected circuit.
 */
const SolverView = ({ circuit }: { circuit: DatasetCircuit }) => {
  const solver = new ComponentDetectionSolver({ inputSrj: circuit.srj })

  return (
    <GenericSolverDebugger
      key={`component-detection-${circuit.id}`}
      solver={solver}
    />
  )
}

export default () => {
  const initialCircuitId = getInitialCircuitId()
  const circuitIndexMap = createCircuitIndexMap()

  // Keep the typed input value separate so invalid edits can still be shown.
  const [currentId, setCurrentId] = useState(initialCircuitId)
  const [inputId, setInputId] = useState(initialCircuitId)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!currentId) return
    const params = new URLSearchParams(window.location.search)
    params.set("circuit", currentId)
    const nextSearch = params.toString()
    let nextUrl = window.location.pathname
    if (nextSearch) {
      nextUrl = `${window.location.pathname}?${nextSearch}`
    }
    window.history.replaceState(null, "", nextUrl)
  }, [currentId])

  let currentIndex = -1
  if (currentId) {
    const matchedIndex = circuitIndexMap.get(currentId)
    if (matchedIndex !== undefined) {
      // Only promote ids that exist in the dataset.
      currentIndex = matchedIndex
    }
  }

  let currentCircuit: DatasetCircuit | null = null
  if (currentIndex >= 0) {
    currentCircuit = circuits[currentIndex]
  }

  const selectFromInputValue = (value: string) => {
    setInputId(value)
    const normalized = normalizeCircuitId(value)
    if (!normalized) {
      setError("Enter a valid circuit id.")
      return
    }

    if (!circuitIndexMap.has(normalized)) {
      setError(`Circuit ${normalized} is missing from dataset-srj16.`)
      return
    }

    // A valid selection updates both the canonical id and the visible input.
    setCurrentId(normalized)
    setInputId(normalized)
    setError("")
  }

  if (!currentCircuit) {
    return <EmptyState error={error} />
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <CircuitSelector
        circuits={circuits}
        currentCircuit={currentCircuit}
        currentIndex={currentIndex}
        inputId={inputId}
        onChange={selectFromInputValue}
      />
      <ErrorMessage error={error} />
      <SolverView circuit={currentCircuit} />
    </div>
  )
}
