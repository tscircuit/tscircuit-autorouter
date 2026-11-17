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
      alt="Complete TSX board with zero Core trace DRC errors"
      src={
        new URL(
          "../../../tests/repro/__snapshots__/sepic-converter-pipeline9-clearance.snap.svg",
          import.meta.url,
        ).href
      }
      style={{ width: "100%", maxWidth: 1000 }}
    />
    <img
      alt="VCC on bottom and GATE on top, with no trace clearance errors"
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
