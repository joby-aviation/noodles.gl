import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadRegistry } from '../src/index.ts'

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url))

// The fixtures with "version" set to the registry's, so a new migration doesn't
// make the valid fixture fail on version alone. Returns a directory holding
// test/fixtures/{valid,broken}/noodles.json.
export function currentFixtures(): string {
  const root = mkdtempSync(join(tmpdir(), 'noodles-validate-'))
  const dir = join(root, 'test/fixtures')
  cpSync(FIXTURES, dir, { recursive: true })
  for (const name of ['valid', 'broken']) {
    const file = join(dir, name, 'noodles.json')
    const project = JSON.parse(readFileSync(file, 'utf8'))
    project.version = loadRegistry().projectVersion
    writeFileSync(file, `${JSON.stringify(project, null, 2)}\n`)
  }
  return root
}
