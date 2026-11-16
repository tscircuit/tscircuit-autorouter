import type { ReactElement } from "react"

// Render the circuit TSX in the test; keep the pinned Core out of Cosmos's bundle.
export default (): ReactElement => (
  <div>
    <p>
      Generated from board.tsx by
      <code>
        {" "}
        bun test tests/repro/sepic-converter-pipeline9-clearance.test.ts
      </code>
    </p>
    <img
      alt="Complete TSX board with one Core trace DRC error"
      src={
        new URL(
          "../../../tests/repro/__snapshots__/sepic-converter-pipeline9-clearance.snap.svg",
          import.meta.url,
        ).href
      }
      style={{ width: "100%", maxWidth: 1000 }}
    />
    <img
      alt="Bottom-layer VCC and GATE clearance: reported 0.053 mm; required 0.1 mm"
      src={
        new URL(
          "../../../tests/repro/__snapshots__/sepic-converter-pipeline9-clearance-bottom-clearance.snap.svg",
          import.meta.url,
        ).href
      }
      style={{ width: "100%", maxWidth: 1000 }}
    />
  </div>
)
