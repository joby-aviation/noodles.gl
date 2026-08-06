// Fixes "route.fulfill: Route is already handled!" unhandled rejection that causes
// @vitest/browser-playwright@4.1.2 to exit with code 1 after teardown. The route
// handler for manual modules doesn't guard against the race where a route is already
// fulfilled by the time the async handler fires. Wrapping in try/catch silences it.
const fs = require('fs')
const path = require('path')

const filePath = path.resolve(__dirname, '../node_modules/@vitest/browser-playwright/dist/index.js')

if (!fs.existsSync(filePath)) {
  console.log('patch: @vitest/browser-playwright not found, skipping')
  process.exit(0)
}

let content = fs.readFileSync(filePath, 'utf-8')

const needle = /(\t+)return route\.fulfill\(\{\n\t+body,\n\t+headers: getHeaders\(this\.project\.browser\.vite\.config\)\n\t+\}\);/

const patchedRouteHandler =
  "try { return await route.fulfill({ body, headers: getHeaders(this.project.browser.vite.config) }) } catch (e) { if (!e?.message?.includes('already handled')) throw e }"

const replacement = (_, indent) => `${indent}${patchedRouteHandler}`

if (content.includes(patchedRouteHandler)) {
  process.exit(0)
}

if (!needle.test(content)) {
  console.warn('patch: @vitest/browser-playwright target not found — patch may be outdated, skipping')
  process.exit(0)
}

fs.writeFileSync(filePath, content.replace(needle, replacement))
console.log('patch: applied @vitest/browser-playwright route.fulfill teardown fix')
