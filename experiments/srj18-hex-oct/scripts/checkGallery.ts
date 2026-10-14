import { chromium } from "playwright"
import { strict as assert } from "node:assert"
import { readFileSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { gunzipSync } from "node:zlib"

type Point = { x: number; y: number }
type Wire = Point & { route_type: "wire"; width: number; layer: string }
type Via = Point & { route_type: "via"; from_layer: string; to_layer: string; outer_diameter?: number; diameter?: number; via_diameter?: number; hole_diameter?: number; drill_diameter?: number; via_type?: string }
type Through = { route_type: "through_obstacle"; start: Point; end: Point; from_layer: string; to_layer: string }
type RawResult = { traces: Array<{ route: Array<Wire | Via | Through> }> }
type RawRecording = { inputs: Record<string, string>; results: Record<string, Record<string, RawResult>> }
type Segment = [string, number, number, number, number, number]
const root = resolve(import.meta.dir, "..")
const recording = JSON.parse(gunzipSync(readFileSync(resolve(root, "recorded/results.json.gz"))).toString()) as RawRecording
const screenshots = resolve(process.argv[2] ?? resolve(root, "work/gallery-qa"))
mkdirSync(screenshots, { recursive: true })

function expectedSegments(result: RawResult): Segment[] {
  const segments: Segment[] = []
  for (const trace of result.traces) for (let i = 0; i+1 < trace.route.length; i++) {
    const point = trace.route[i], target = trace.route[i+1]
    if (point.route_type !== "wire") continue
    if (target.route_type === "wire" && target.layer !== point.layer) continue
    const end = target.route_type === "through_obstacle" ? target.start : target
    segments.push([point.layer, point.width, point.x, point.y, end.x, end.y])
  }
  return segments
}

function expectedVias(result: RawResult): Array<[number, number, number, number]> {
  const unique = new Map<string, [number, number, number, number]>()
  for (const trace of result.traces) for (const point of trace.route) {
    if (point.route_type !== "via") continue
    const via: [number, number, number, number] = [point.x, point.y, point.outer_diameter ?? point.diameter ?? point.via_diameter ?? 0.3, point.hole_diameter ?? point.drill_diameter ?? 0.15]
    unique.set(JSON.stringify(via), via)
  }
  return [...unique.values()]
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } })
const errors: string[] = []
page.on("pageerror", error => errors.push(error.message))
await page.goto(pathToFileURL(resolve(root, "gallery.html")).href)
await page.waitForFunction(() => window.srj18GalleryReady)
assert.equal(await page.locator("main table").count(), 2)
assert.equal(await page.locator("section.board").count(), 16)
assert.equal(await page.locator(".router-card").count(), 144)
const layout = await page.locator(".router-row").evaluateAll(rows => rows.every(row => {
  const cards = Array.from(row.children).map(card => card.getBoundingClientRect())
  return cards.length === 9 && cards.every(card => Math.abs(card.top-cards[0].top)<1) && row.scrollWidth>row.clientWidth
}))
assert.equal(layout, true, "Router cards must stay in one horizontally scrolling row")
let imagesChecked = 0
let layerViewsChecked = 0
for (const [sample, text] of Object.entries(recording.inputs)) {
  const input = JSON.parse(text) as { layerCount: number }
  const layers = ["top", ...Array.from({length:input.layerCount-2},(_,i)=>`inner${i+1}`), "bottom"]
  const section = page.locator(`#${sample}`)
  await section.scrollIntoViewIfNeeded()
  for (const variant of Object.keys(recording.results)) {
    const card = section.locator(`[data-variant="${variant}"]`)
    await card.scrollIntoViewIfNeeded()
    await page.waitForFunction(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth>0, await card.locator(".board-image").elementHandle())
    const actual = await card.locator(".board-image").evaluate(async image => {
      const xml = new DOMParser().parseFromString(await (await fetch((image as HTMLImageElement).src)).text(), "image/svg+xml")
      if (xml.querySelector("parsererror")) throw new Error("Invalid generated SVG")
      const segments: Segment[] = []
      for (const path of xml.querySelectorAll("[data-copper-layer]")) {
        const layer = path.getAttribute("data-copper-layer")!
        const width = Number(path.getAttribute("stroke-width"))
        const points = path.getAttribute("d")!.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)!.map(Number)
        for(let i=0;i<points.length;i+=4)segments.push([layer,width,points[i],points[i+1],points[i+2],points[i+3]])
      }
      const vias = Array.from(xml.querySelectorAll("g[data-via]")).map(group => {
        const [x, y] = group.getAttribute("transform")!.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)!.map(Number)
        const circles = group.querySelectorAll("circle")
        return [x,y,Number(circles[0].getAttribute("r"))*2,Number(circles[1].getAttribute("r"))*2]
      })
      return { segments, vias }
    })
    const expected = expectedSegments(recording.results[variant][sample])
    assert.deepEqual(actual.segments.sort(), expected.sort(), `${sample}/${variant}: displayed copper must match recorded coordinates, layers and widths`)
    assert.deepEqual(actual.vias.sort(), expectedVias(recording.results[variant][sample]).sort(), `${sample}/${variant}: via coordinates and diameters must match recorded output`)
    imagesChecked++
  }
  for (const layer of layers) {
    await section.locator(".board-layer").selectOption(layer)
    for (const variant of Object.keys(recording.results)) {
      const card = section.locator(`[data-variant="${variant}"]`)
      const actual = await card.locator(".board-image").evaluate(async image => {
        const xml = new DOMParser().parseFromString(await (await fetch((image as HTMLImageElement).src)).text(), "image/svg+xml")
        return Array.from(xml.querySelectorAll("[data-copper-layer]")).map(path => ({layer:path.getAttribute("data-copper-layer"),count:(path.getAttribute("d")!.match(/M /g)??[]).length}))
      })
      assert.ok(actual.every(path => path.layer === layer), `${sample}/${variant}: hidden copper leaked into ${layer}`)
      assert.equal(actual.reduce((sum,path)=>sum+path.count,0), expectedSegments(recording.results[variant][sample]).filter(segment=>segment[0]===layer).length)
      layerViewsChecked++
    }
  }
  await section.locator(".board-layer").selectOption("all")
}
await page.locator('#sample004 [data-variant="hex-p020"]').scrollIntoViewIfNeeded()
await page.locator('#sample004 .router-row').evaluate(row => {row.scrollLeft=0})
await page.locator("#sample004").screenshot({ path: resolve(screenshots,"gallery-preview.png") })
await page.locator('#sample004 [data-variant="hex-p020"] .inspect').click()
await page.locator("#detail-layer").selectOption("bottom")
await page.locator("#zoom-in").click()
assert.equal(await page.locator("#zoom-label").textContent(), "150%")
await page.locator("#detail-close").click()
assert.equal(await page.locator('#sample004 [data-variant="hex-p020"]').getAttribute("data-rendered-layer"), "all", "Popup layer selection must not change the comparison row")
await page.locator('[data-jump-variant="freerouting"][href="#sample006"]').click()
await page.locator('#sample006 [data-variant="freerouting"]').scrollIntoViewIfNeeded()
assert.ok(await page.locator('#sample006 .router-row').evaluate(row => row.scrollLeft)>0)
assert.deepEqual(errors, [])
await page.setViewportSize({ width:390,height:844 })
await page.locator("#sample004").scrollIntoViewIfNeeded()
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=window.innerWidth+1), true, "Mobile body must not overflow horizontally")
await page.locator("#sample004").screenshot({path:resolve(screenshots,"gallery-mobile.png")})
await browser.close()
console.log(JSON.stringify({ cards:144, exactCoordinateImagesChecked:imagesChecked, individualLayerViewsChecked:layerViewsChecked, horizontalRows:16, modalZoom:true, matrixNavigation:true, mobileOverflow:false, pageErrors:errors.length }))
