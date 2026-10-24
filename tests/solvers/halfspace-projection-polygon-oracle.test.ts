import { expect, test } from "bun:test"
import { HalfspaceProjectionSolver, type LinearHalfspace } from "lib/solvers/HalfspaceProjectionSolver"

type Point = { x: number; y: number }

test("coupled half-space witnesses agree with an independent clipped-polygon oracle and never claim infeasibility", (): void => {
  let seed = 3713
  for (let model = 0; model < 128; model++) {
    const rows: LinearHalfspace[] = [
      { terms: [{ variable: 0, coefficient: 1 }], maximum: 0.25 },
      { terms: [{ variable: 0, coefficient: -1 }], maximum: 0.25 },
      { terms: [{ variable: 1, coefficient: 1 }], maximum: 0.25 },
      { terms: [{ variable: 1, coefficient: -1 }], maximum: 0.25 },
    ]
    const rotation = model * 0.1237
    const center = { x: Math.sin(model) * 0.1, y: Math.cos(model) * 0.1 }
    for (let family = 0; family < 8; family++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const angle = rotation + family * Math.PI / 4
      const nx = Math.cos(angle), ny = Math.sin(angle)
      rows.push({
        terms: [{ variable: 0, coefficient: nx }, { variable: 1, coefficient: ny }],
        maximum: nx * center.x + ny * center.y + 0.02 + (seed % 100) / 1000,
        family,
      })
    }
    if (model % 2 === 1) rows.push(
      { terms: [{ variable: 0, coefficient: 1 }], maximum: -0.2, family: 8 },
      { terms: [{ variable: 0, coefficient: -1 }], maximum: -0.2, family: 9 },
    )
    let polygon: Point[] = [{ x: -0.25, y: -0.25 }, { x: 0.25, y: -0.25 }, { x: 0.25, y: 0.25 }, { x: -0.25, y: 0.25 }]
    for (const row of rows) {
      const value = (point: Point): number => row.terms.reduce((sum, term): number => sum + term.coefficient * (term.variable === 0 ? point.x : point.y), -row.maximum)
      const next: Point[] = []
      for (let index = 0; index < polygon.length; index++) {
        const a = polygon[index]!, b = polygon[(index + 1) % polygon.length]!
        const va = value(a), vb = value(b)
        if (va <= 0) next.push(a)
        if ((va <= 0) !== (vb <= 0)) {
          const t = va / (va - vb)
          next.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) })
        }
      }
      polygon = next
    }
    const solver = new HalfspaceProjectionSolver(2, rows, 2_000_000)
    solver.solve()
    const result = solver.getOutput()
    if (polygon.length === 0) {
      expect(result.status === "unknown" || result.status === "contradictory-choice").toBe(true)
      if (result.status === "unknown") expect(result.residualFamilies.length).toBeGreaterThan(0)
      if (result.status === "contradictory-choice") {
        const a = rows[result.certificate.rows[0]]!, b = rows[result.certificate.rows[1]]!
        expect(a.maximum + b.maximum).toBeLessThan(0)
        for (const term of a.terms) {
          expect(b.terms.find((other): boolean => other.variable === term.variable)?.coefficient).toBe(-term.coefficient)
        }
      }
    } else {
      expect(result.status).toBe("feasible")
      if (result.status === "feasible") for (const row of rows) {
        const residual = row.terms.reduce((sum, term): number => sum + term.coefficient * result.values[term.variable]!, -row.maximum)
        expect(residual).toBeLessThanOrEqual(1e-10)
      }
    }
    expect(solver.constraintChecks).toBeLessThanOrEqual(2_000_000)
  }
})
