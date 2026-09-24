import { describe, expect, it, vi } from 'vitest'
import { scoreTools } from './agent/tool-router'
import { runCode } from './run-code'
import { availableToolDefinitions, getToolDefinition } from './tool-definitions'

// safeMode is read once at module load in globals.ts, so it has to be mocked at the
// module level — hence a separate file from run-code.test.ts, where every test needs
// the code to actually evaluate.
vi.mock('../noodles/globals', async importOriginal => ({
  ...(await importOriginal<typeof import('../noodles/globals')>()),
  safeMode: true,
}))

// Safe mode exists to stop the app executing arbitrary code, so run_code has to be
// gone from every surface at once: discovery, dispatch, and the evaluator itself. A
// tool the model can see but that always refuses would waste turns arguing with it.
describe('run_code in safe mode', () => {
  it('is not among the available tool definitions', () => {
    expect(availableToolDefinitions().map(d => d.name)).not.toContain('run_code')
  })

  it('does not resolve by name, so the loop reports it as unknown', () => {
    expect(getToolDefinition('run_code')).toBeUndefined()
    // The rest of the surface is untouched
    expect(getToolDefinition('list_nodes')).toBeDefined()
  })

  it('is not findable through find_tools', () => {
    for (const query of ['run javascript', 'evaluate code', 'compute a statistic']) {
      expect(scoreTools(query).map(m => m.name)).not.toContain('run_code')
    }
  })

  it('refuses to evaluate even when called directly', async () => {
    const result = await runCode({ code: 'return 1 + 1' })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/safe mode/i)
  })
})
