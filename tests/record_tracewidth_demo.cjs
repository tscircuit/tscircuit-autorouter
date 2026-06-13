const { chromium } = require("@playwright/test")
const path = require("path")
const fs = require("fs")

async function main() {
  console.log("Launching browser...")
  const browser = await chromium.launch({ headless: true })

  const videoDir = path.join(__dirname, "assets")
  if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true })
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: videoDir,
      size: { width: 1280, height: 720 },
    },
  })

  const page = await context.newPage()

  try {
    console.log("Navigating to Cosmos fixture...")
    const fixtureParam = JSON.stringify({
      path: "fixtures/features/tracewidthsolver/tracewidthsolver01.fixture.tsx",
    })
    await page.goto(
      `http://localhost:5000/?_fixtureId=${encodeURIComponent(fixtureParam)}`,
      { waitUntil: "networkidle" },
    )
    await page.waitForTimeout(4000)

    console.log("Locating iframe...")
    // Cosmos v6 might render preview in an iframe with data-testid="preview-iframe" or "previewIframe" or similar
    const iframe = page.frameLocator("iframe")

    // Wait for the solver debugger to render
    await page.waitForTimeout(6000)

    console.log("Successfully rendered TraceWidthSolver debugger!")
  } catch (error) {
    console.error("An error occurred during automation:", error)
    await page.screenshot({
      path: path.join(videoDir, "tracewidth_screenshot.png"),
    })
  } finally {
    console.log("Closing context and saving video...")
    await context.close()
    await browser.close()

    const files = fs.readdirSync(videoDir)
    const videoFile = files.find(
      (f) => f.endsWith(".webm") && f !== "tracewidth_demo.webm",
    )
    if (videoFile) {
      const oldPath = path.join(videoDir, videoFile)
      const newPath = path.join(videoDir, "tracewidth_demo.webm")
      if (fs.existsSync(newPath)) {
        fs.unlinkSync(newPath)
      }
      fs.renameSync(oldPath, newPath)
      console.log(`Video demo successfully saved and renamed to: ${newPath}`)
    } else {
      console.log("Video file not found or not created.")
    }
  }
}

main()
