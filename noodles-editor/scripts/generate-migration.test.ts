import { spawn } from 'node:child_process'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

const cwd = path.join(import.meta.dirname, '..')

// Runs a script with no input and collects its output. `--import tsx` loads
// TypeScript without the tsx CLI, which needs a local IPC socket.
function runScript(script: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', script], { cwd })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', () => resolve({ stdout, stderr }))
    child.stdin.end()
  })
}

describe('generate-migration', () => {
  it('finds the migrations folder and asks the first question', async () => {
    const { stdout, stderr } = await runScript('scripts/generate-migration.ts')

    expect(stderr).not.toContain('ReferenceError')
    expect(stdout).toMatch(/Next migration version: \d+/)
    expect(stdout).toContain('Operator type')
  }, 20_000)
})
