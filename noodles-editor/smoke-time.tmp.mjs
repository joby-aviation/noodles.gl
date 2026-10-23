import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.goto('http://localhost:5191/examples/chargers', { waitUntil: 'load' })
await page.waitForTimeout(8000)
for (let round = 0; round < 3; round++) {
  const r = await page.evaluate(async () => {
    const ops = await import('/src/noodles/operators.ts')
    const store = await import('/src/noodles/store.tsx')
    let time = store.getOp('/smoke-time')
    if (!time) { time = new ops.TimeOp('/smoke-time'); store.setOp('/smoke-time', time); await new Promise(r => setTimeout(r, 500)) }
    const t0 = time.outputs.tick.value
    let raf = 0
    const s = performance.now()
    await new Promise(res => { const f = () => { raf++; performance.now() - s < 2000 ? requestAnimationFrame(f) : res() }; requestAnimationFrame(f) })
    return { raf, ticks: time.outputs.tick.value - t0, elapsed: Math.round(performance.now() - s) }
  })
  console.log(JSON.stringify(r))
}
await browser.close()
