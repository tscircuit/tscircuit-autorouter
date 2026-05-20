import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import * as datasetSrj16 from "@tsci/tscircuit.dataset-srj16-bga-breakouts"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
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

const getInitialCircuitId = () => {
  const params = new URLSearchParams(window.location.search)
  const requested = normalizeCircuitId(params.get("circuit") ?? "")
  if (requested && circuits.some((entry) => entry.id === requested)) {
    return requested
  }

  return circuits[0]?.id ?? ""
}

const createCircuitIndexMap = () => {
  const map = new Map<string, number>()
  for (const [index, circuit] of circuits.entries()) {
    map.set(circuit.id, index)
  }
  return map
}

const ErrorMessage = ({ error }: { error: string }) => {
  if (!error) {
    return null
  }

  return <div style={{ color: "red" }}>{error}</div>
}

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

  const minValue = Number(circuits[0]?.id ?? "1")
  const maxValue = Number(circuits[circuits.length - 1]?.id ?? "999")

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

const SolverView = ({ circuit }: { circuit: DatasetCircuit }) => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(circuit.srj)

  return (
    <GenericSolverDebugger
      key={`pipeline7-${circuit.id}`}
      solver={solver as any}
    />
  )
}

export default () => {
  const initialCircuitId = getInitialCircuitId()
  const circuitIndexMap = createCircuitIndexMap()
  const [currentId, setCurrentId] = useState(initialCircuitId)
  const [inputId, setInputId] = useState(initialCircuitId)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!currentId) return
    const params = new URLSearchParams(window.location.search)
    params.set("circuit", currentId)
    const nextSearch = params.toString()
    const nextUrl = nextSearch
      ? `${window.location.pathname}?${nextSearch}`
      : window.location.pathname
    window.history.replaceState(null, "", nextUrl)
  }, [currentId])

  const currentIndex =
    currentId === "" ? -1 : (circuitIndexMap.get(currentId) ?? -1)
  const currentCircuit = currentIndex >= 0 ? circuits[currentIndex] : null

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
