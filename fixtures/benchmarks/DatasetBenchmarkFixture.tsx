import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { SimpleRouteJson } from "lib/types"
import { useEffect, useMemo, useState } from "react"

export type DatasetCircuit = {
  id: string
  srj: SimpleRouteJson
}

type DatasetBenchmarkFixtureProps = {
  datasetLabel: string
  circuits: readonly DatasetCircuit[]
}

type ViewState = "unavailable" | "ready"

const normalizeCircuitId = (value: string) => {
  const digits = value.replace(/[^0-9]/g, "")
  if (digits.length === 0) return null
  return digits.padStart(3, "0").slice(-3)
}

export const DatasetBenchmarkFixture = ({
  datasetLabel,
  circuits,
}: DatasetBenchmarkFixtureProps) => {
  const sortedCircuits = useMemo(
    () => [...circuits].sort((a, b) => Number(a.id) - Number(b.id)),
    [circuits],
  )
  const [currentId, setCurrentId] = useState<string>("")
  const [inputId, setInputId] = useState<string>("")
  const [error, setError] = useState<string>("")

  useEffect(() => {
    if (sortedCircuits.length === 0) {
      setError(`No circuits were found in ${datasetLabel}.`)
      return
    }

    const params = new URLSearchParams(window.location.search)
    const requested = normalizeCircuitId(params.get("circuit") ?? "")
    const requestedExists = requested
      ? sortedCircuits.some((entry) => entry.id === requested)
      : false

    if (requested && !requestedExists) {
      setError(`Circuit ${requested} is missing from this dataset.`)
    }

    const initialId =
      requested && requestedExists ? requested : sortedCircuits[0].id
    setCurrentId(initialId)
    setInputId(initialId)
  }, [datasetLabel, sortedCircuits])

  useEffect(() => {
    if (!currentId) return
    const params = new URLSearchParams(window.location.search)
    params.set("circuit", currentId)
    const nextSearch = params.toString()
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}`,
    )
  }, [currentId])

  const circuitIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const [index, circuit] of sortedCircuits.entries()) {
      map.set(circuit.id, index)
    }
    return map
  }, [sortedCircuits])

  const currentIndex = currentId ? (circuitIndexMap.get(currentId) ?? -1) : -1
  const currentCircuit = currentIndex >= 0 ? sortedCircuits[currentIndex] : null

  const selectFromInputValue = (value: string) => {
    setInputId(value)
    const normalized = normalizeCircuitId(value)
    if (!normalized) {
      setError("Enter a valid circuit id.")
      return
    }

    if (!circuitIndexMap.has(normalized)) {
      setError(`Circuit ${normalized} is missing from this dataset.`)
      return
    }

    setCurrentId(normalized)
    setInputId(normalized)
    setError("")
  }

  const viewState: ViewState = currentCircuit ? "ready" : "unavailable"

  switch (viewState) {
    case "unavailable":
      return (
        <div>
          <div>Unable to display a circuit.</div>
          {error && <div style={{ color: "red", marginTop: 8 }}>{error}</div>}
        </div>
      )
    case "ready": {
      if (!currentCircuit) {
        return (
          <div>
            <div>Unable to display a circuit.</div>
            {error && <div style={{ color: "red", marginTop: 8 }}>{error}</div>}
          </div>
        )
      }

      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label>
              Circuit ID:{" "}
              <input
                type="number"
                min={Number(sortedCircuits[0]?.id ?? "1")}
                max={Number(
                  sortedCircuits[sortedCircuits.length - 1]?.id ?? "999",
                )}
                value={inputId === "" ? "" : Number(inputId)}
                onChange={(e) => selectFromInputValue(e.currentTarget.value)}
              />
            </label>{" "}
            <span>
              (Current: {currentCircuit.id}, {currentIndex + 1} /{" "}
              {sortedCircuits.length})
            </span>
          </div>

          {error && <div style={{ color: "red" }}>{error}</div>}

          <AutoroutingPipelineDebugger
            key={`${datasetLabel}-${currentCircuit.id}`}
            srj={currentCircuit.srj}
          />
        </div>
      )
    }
  }
}
