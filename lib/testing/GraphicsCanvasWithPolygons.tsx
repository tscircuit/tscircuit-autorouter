import { useRef, useEffect, useState } from "react"
import { drawGraphicsToCanvas, getBounds } from "graphics-debug"
import type { GraphicsObject } from "graphics-debug"
import useMouseMatrixTransform from "use-mouse-matrix-transform"
import { compose, scale, translate, applyToPoint } from "transformation-matrix"
import useResizeObserver from "@react-hook/resize-observer"

export interface FilledPolygon {
  points: { x: number; y: number }[]
  fill?: string
  stroke?: string
  strokeWidth?: number
  step?: number
  label?: string
}

export interface ExtendedGraphicsObject extends GraphicsObject {
  polygons?: FilledPolygon[]
}

function getMaxStep(graphics: ExtendedGraphicsObject): number {
  let max = 0
  for (const p of graphics.points ?? [])
    if (p.step !== undefined && p.step > max) max = p.step
  for (const l of graphics.lines ?? [])
    if (l.step !== undefined && l.step > max) max = l.step
  for (const r of graphics.rects ?? [])
    if (r.step !== undefined && r.step > max) max = r.step
  for (const c of graphics.circles ?? [])
    if (c.step !== undefined && c.step > max) max = c.step
  for (const t of graphics.texts ?? [])
    if (t.step !== undefined && t.step > max) max = t.step
  for (const p of graphics.polygons ?? [])
    if (p.step !== undefined && p.step > max) max = p.step
  return max
}

function getGraphicsBoundsWithPadding(graphics: GraphicsObject) {
  const bounds = getBounds(graphics)
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  return {
    minX: bounds.minX - width / 10,
    minY: bounds.minY - height / 10,
    maxX: bounds.maxX + width / 10,
    maxY: bounds.maxY + height / 10,
  }
}

function filterByStep(
  graphics: ExtendedGraphicsObject,
  activeStep: number | null,
  showLastStep: boolean,
  maxStep: number,
): ExtendedGraphicsObject {
  const selectedStep = showLastStep ? maxStep : activeStep
  if (selectedStep === null) return graphics
  return {
    ...graphics,
    points: graphics.points?.filter(
      (p) => p.step === undefined || p.step === selectedStep,
    ),
    lines: graphics.lines?.filter(
      (l) => l.step === undefined || l.step === selectedStep,
    ),
    rects: graphics.rects?.filter(
      (r) => r.step === undefined || r.step === selectedStep,
    ),
    circles: graphics.circles?.filter(
      (c) => c.step === undefined || c.step === selectedStep,
    ),
    texts: graphics.texts?.filter(
      (t) => t.step === undefined || t.step === selectedStep,
    ),
    polygons: graphics.polygons?.filter(
      (p) => p.step === undefined || p.step === selectedStep,
    ),
  }
}

export function GraphicsCanvasWithPolygons({
  graphics,
  showLabelsByDefault = true,
  showGrid = true,
  height = 500,
  width = "100%",
}: {
  graphics: ExtendedGraphicsObject
  showLabelsByDefault?: boolean
  showGrid?: boolean
  height?: number | string
  width?: number | string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 600, height: 600 })
  const [activeStep, setActiveStep] = useState<number | null>(null)
  const [showLabels, setShowLabels] = useState(showLabelsByDefault)
  const [showLastStep, setShowLastStep] = useState(true)

  const maxStep = getMaxStep(graphics)
  const filtered = filterByStep(graphics, activeStep, showLastStep, maxStep)

  const boundsWithPadding = getGraphicsBoundsWithPadding(graphics)
  const { transform, ref: mouseTransformRef } = useMouseMatrixTransform({
    initialTransform: compose(
      translate(size.width / 2, size.height / 2),
      scale(
        Math.min(
          size.width / (boundsWithPadding.maxX - boundsWithPadding.minX),
          size.height / (boundsWithPadding.maxY - boundsWithPadding.minY),
        ),
        -Math.min(
          size.width / (boundsWithPadding.maxX - boundsWithPadding.minX),
          size.height / (boundsWithPadding.maxY - boundsWithPadding.minY),
        ),
      ),
      translate(
        -(boundsWithPadding.maxX + boundsWithPadding.minX) / 2,
        -(boundsWithPadding.maxY + boundsWithPadding.minY) / 2,
      ),
    ),
  })

  useResizeObserver(containerRef, (entry) => {
    setSize({
      width: entry.contentRect.width,
      height: entry.contentRect.height,
    })
  })

  const drawCanvas = () => {
    if (!canvasRef.current) return
    canvasRef.current.width = size.width
    canvasRef.current.height = size.height

    // Draw standard graphics primitives
    drawGraphicsToCanvas(filtered, canvasRef.current, {
      transform,
      disableLabels: !showLabels,
    })

    // Draw filled polygons
    const polygons = filtered.polygons
    if (polygons && polygons.length > 0) {
      const ctx = canvasRef.current.getContext("2d")
      if (ctx) {
        ctx.save()
        for (const poly of polygons) {
          if (poly.points.length < 3) continue
          ctx.beginPath()
          const first = applyToPoint(transform, poly.points[0]!)
          ctx.moveTo(first.x, first.y)
          for (let i = 1; i < poly.points.length; i++) {
            const pt = applyToPoint(transform, poly.points[i]!)
            ctx.lineTo(pt.x, pt.y)
          }
          ctx.closePath()
          if (poly.fill) {
            ctx.fillStyle = poly.fill
            ctx.fill()
          }
          if (poly.stroke) {
            ctx.strokeStyle = poly.stroke
            ctx.lineWidth = (poly.strokeWidth ?? 1) * Math.abs(transform.a)
            ctx.stroke()
          }
        }
        ctx.restore()
      }
    }

    if (showGrid) {
      drawGrid(canvasRef.current)
    }
  }

  const drawGrid = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.save()
    ctx.beginPath()
    const tp = (p: { x: number; y: number }) => applyToPoint(transform, p)
    const xStart = tp({ x: -1000, y: 0 })
    const xEnd = tp({ x: 1000, y: 0 })
    ctx.moveTo(xStart.x, xStart.y)
    ctx.lineTo(xEnd.x, xEnd.y)
    const yStart = tp({ x: 0, y: -1000 })
    const yEnd = tp({ x: 0, y: 1000 })
    ctx.moveTo(yStart.x, yStart.y)
    ctx.lineTo(yEnd.x, yEnd.y)
    ctx.strokeStyle = "#aaa"
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.beginPath()
    ctx.setLineDash([2, 2])
    for (let x = -100; x <= 100; x += 10) {
      if (x === 0) continue
      const s = tp({ x, y: -100 })
      const e = tp({ x, y: 100 })
      ctx.moveTo(s.x, s.y)
      ctx.lineTo(e.x, e.y)
    }
    for (let y = -100; y <= 100; y += 10) {
      if (y === 0) continue
      const s = tp({ x: -100, y })
      const e = tp({ x: 100, y })
      ctx.moveTo(s.x, s.y)
      ctx.lineTo(e.x, e.y)
    }
    ctx.strokeStyle = "#ddd"
    ctx.stroke()
    ctx.restore()
  }

  useEffect(() => {
    drawCanvas()
  }, [transform, size, filtered, showGrid, showLabels])

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <label>
            <input
              type="checkbox"
              style={{ marginRight: 4 }}
              checked={activeStep !== null}
              onChange={(e) => setActiveStep(e.target.checked ? 0 : null)}
            />
            Filter by step
          </label>
          <input
            type="number"
            min={0}
            max={maxStep}
            value={activeStep ?? 0}
            onChange={(e) => {
              const value = parseInt(e.target.value)
              setShowLastStep(false)
              setActiveStep(Number.isNaN(value) ? 0 : Math.min(value, maxStep))
            }}
            disabled={activeStep === null}
            style={{ width: "60px" }}
          />
          <label>
            <input
              type="checkbox"
              style={{ marginRight: 4 }}
              checked={showLastStep}
              onChange={(e) => {
                setShowLastStep(e.target.checked)
                setActiveStep(null)
              }}
            />
            Show last step
          </label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <label>
            <input
              type="checkbox"
              style={{ marginRight: 4 }}
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
            />
            Show labels
          </label>
        </div>
      </div>
      <div
        ref={(node) => {
          containerRef.current = node
          if (mouseTransformRef && node) {
            ;(mouseTransformRef as any).current = node
          }
        }}
        style={{
          position: "relative",
          width,
          height,
          border: "1px solid #ccc",
          overflow: "hidden",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width,
            height,
          }}
        />
      </div>
    </div>
  )
}
