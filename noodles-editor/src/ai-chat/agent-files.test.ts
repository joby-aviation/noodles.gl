import { beforeEach, describe, expect, it } from 'vitest'
import { useFileSystemStore } from '../noodles/filesystem-store'
import { readAsset } from '../noodles/storage'
import { memoryProjectStore } from '../noodles/utils/memory-project-store'
import { capToolResult } from './agent/result-budget'
import { scoreTools } from './agent/tool-router'
import { grepFiles, listFiles, readFile, resolvePath, writeFile } from './agent-files'

const PROJECT = 'agent-files-test'

// A NUL written as an escape rather than as a literal byte, so the source file stays
// text and greppable
const NUL = '\u0000'

function data(result: { data?: unknown }): Record<string, unknown> {
  return (result.data ?? {}) as Record<string, unknown>
}

// Examples load into memory storage (noodles.tsx copies their assets there), so the
// memory store is the realistic backing for these tools, not a stand-in
function put(name: string, contents: string): void {
  memoryProjectStore.writeAsset(PROJECT, name, contents)
}

beforeEach(() => {
  memoryProjectStore.deleteProject(PROJECT)
  useFileSystemStore.setState({ activeStorageType: 'memory', currentProjectName: PROJECT })
  put('trips.csv', 'id,fare,borough\n1,12.5,Queens\n2,31.0,Manhattan\n')
  put('zones.geojson', '{"type":"FeatureCollection","features":[]}\n')
  put('raw/notes.txt', 'nothing to see\n')
})

// The guard is the security boundary for the whole module, so it is tested directly
// and exhaustively rather than only through the tools that call it.
describe('the path guard', () => {
  it('accepts a plain relative path', () => {
    expect(resolvePath('trips.csv')).toEqual({ ok: true, relative: 'trips.csv' })
  })

  it('accepts both spellings the model will have seen', () => {
    // @/ is what appears in a FileOp's url; data/ is what appears in project JSON
    expect(resolvePath('@/trips.csv')).toEqual({ ok: true, relative: 'trips.csv' })
    expect(resolvePath('data/trips.csv')).toEqual({ ok: true, relative: 'trips.csv' })
  })

  it('normalizes redundant separators and dots', () => {
    expect(resolvePath('./raw//notes.txt')).toEqual({ ok: true, relative: 'raw/notes.txt' })
    expect(resolvePath('  trips.csv  ')).toEqual({ ok: true, relative: 'trips.csv' })
  })

  it('resolves an interior .. instead of rejecting the string', () => {
    // Rejecting any path containing '..' would be simpler and wrong: this is a legal
    // path to raw/notes.txt, and refusing it teaches the model to distrust the tool
    expect(resolvePath('raw/../raw/notes.txt')).toEqual({ ok: true, relative: 'raw/notes.txt' })
  })

  it.each([
    '../secrets.txt',
    'raw/../../secrets.txt',
    '@/../../etc/passwd',
    'data/../../..',
    'a/b/../../../c',
  ])('rejects an escape attempt: %s', path => {
    const result = resolvePath(path)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/outside the project data directory/)
  })

  it('rejects absolute paths', () => {
    const result = resolvePath('/etc/passwd')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not absolute/)
  })

  it('rejects a backslash rather than treating it as a separator', () => {
    // A backslash is legal in a POSIX name, so silently accepting `..\secrets` would
    // create a strangely-named file; naming the mistake is more useful
    const result = resolvePath('..\\secrets.txt')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Use \/ to separate/)
  })

  it('rejects a null byte', () => {
    const result = resolvePath(`trips.csv${NUL}.png`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/null byte/)
  })

  it.each(['', '   '])('rejects an empty path: %j', path => {
    expect(resolvePath(path).ok).toBe(false)
  })

  it('allows a write inside the scratch directory', () => {
    expect(resolvePath('.agent/out.csv', { forWrite: true })).toEqual({
      ok: true,
      relative: '.agent/out.csv',
    })
    expect(resolvePath('@/.agent/sub/out.csv', { forWrite: true })).toEqual({
      ok: true,
      relative: '.agent/sub/out.csv',
    })
  })

  it.each([
    'trips.csv',
    'data/trips.csv',
    '@/zones.geojson',
    'raw/notes.txt',
    '.agentx/out.csv',
    '.agent',
    'sub/.agent/out.csv',
  ])('rejects a write outside the scratch directory: %s', path => {
    const result = resolvePath(path, { forWrite: true })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/only allowed inside @\/\.agent\//)
  })

  it('checks the resolved path for writes, not the string', () => {
    // The whole reason resolution comes first: this one *looks* like it is inside the
    // scratch directory and is not, and this one looks like it leaves and does not
    expect(resolvePath('.agent/../trips.csv', { forWrite: true }).ok).toBe(false)
    expect(resolvePath('.agent/../.agent/out.csv', { forWrite: true })).toEqual({
      ok: true,
      relative: '.agent/out.csv',
    })
  })

  it('refuses to write into the backup directory', () => {
    const result = resolvePath('.agent/.previous/out.csv', { forWrite: true })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not writable/)
  })
})

describe('list_files', () => {
  it('lists the project data files and names the scratch directory', async () => {
    const result = await listFiles({})
    expect(result.success).toBe(true)
    expect(data(result).files).toEqual(['raw/notes.txt', 'trips.csv', 'zones.geojson'])
    expect(data(result).count).toBe(3)
    expect(data(result).scratchDirectory).toBe('@/.agent/')
  })

  it('scopes to a subdirectory', async () => {
    const result = await listFiles({ path: 'raw' })
    expect(data(result).files).toEqual(['raw/notes.txt'])
    expect(data(result).directory).toBe('@/raw')
  })

  it('hides the backup directory', async () => {
    put('.agent/out.csv', 'a\n')
    put('.agent/.previous/out.csv', 'old\n')
    const files = data(await listFiles({})).files as string[]
    expect(files).toContain('.agent/out.csv')
    expect(files).not.toContain('.agent/.previous/out.csv')
  })

  it('truncates a long listing and says so', async () => {
    for (let i = 0; i < 20; i++) put(`bulk/f${i}.csv`, 'x\n')
    const result = await listFiles({ maxResults: 5 })
    expect((data(result).files as string[]).length).toBe(5)
    expect(data(result).count).toBe(23)
    expect(data(result).truncated).toMatch(/showing 5 of 23/)
  })

  it('rejects a path that escapes the data directory', async () => {
    const result = await listFiles({ path: '../..' })
    expect(result.success).toBe(false)
  })
})

describe('read_file', () => {
  it('returns a small file whole', async () => {
    const result = await readFile({ path: '@/trips.csv' })
    expect(result.success).toBe(true)
    expect(data(result).content).toContain('1,12.5,Queens')
    expect(data(result).path).toBe('@/trips.csv')
  })

  it('names the missing file in the error', async () => {
    const result = await readFile({ path: 'nope.csv' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/nope\.csv/)
  })

  it('refuses a file that is not text', async () => {
    put('tile.png', `PNG${NUL}${NUL}data`)
    const result = await readFile({ path: 'tile.png' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not a text file/)
  })

  it('pages through a file with startLine/endLine', async () => {
    put('big.csv', Array.from({ length: 100 }, (_, i) => `row ${i}`).join('\n'))
    const result = await readFile({ path: 'big.csv', startLine: 10, endLine: 12 })
    expect(data(result).range).toBe('10-12')
    expect(data(result).content).toBe('row 9\nrow 10\nrow 11')
  })

  it('clamps a range that runs past the end of the file', async () => {
    const result = await readFile({ path: 'trips.csv', startLine: 3, endLine: 900 })
    expect(data(result).range).toBe('3-4')
  })

  it('summarizes a file too large to send, rather than sending it', async () => {
    // The point of the tool: a 50MB CSV must not be able to enter the transcript, so
    // the summary happens here and run_code is where the full contents get used
    const lines = Array.from({ length: 50_000 }, (_, i) => `${i},${i * 1.5},Queens`)
    put('huge.csv', lines.join('\n'))

    const result = await readFile({ path: 'huge.csv' })
    expect(result.success).toBe(true)
    expect(data(result).content).toBeUndefined()
    expect(data(result).lines).toBe(50_000)
    expect((data(result).head as string[]).length).toBe(30)
    expect((data(result).tail as string[]).length).toBe(10)
    expect(data(result).note).toMatch(/run_code/)

    const capped = capToolResult('read_file', result, 24_000)
    expect(capped.truncated).toBe(false)
    expect(capped.chars).toBeLessThan(4000)
  })

  it('clips a single absurdly long line', async () => {
    put('wide.csv', `${'x'.repeat(5000)}\n${'y'.repeat(5000)}\n`.repeat(200))
    const result = await readFile({ path: 'wide.csv' })
    for (const line of data(result).head as string[]) {
      expect(line.length).toBeLessThan(500)
    }
  })
})

describe('write_file', () => {
  it('writes into the scratch directory and returns a FileOp-ready path', async () => {
    const result = await writeFile({ path: '.agent/joined.csv', content: 'a,b\n1,2\n' })
    expect(result.success).toBe(true)
    expect(data(result).path).toBe('@/.agent/joined.csv')
    expect(data(result).bytes).toBe(8)
    expect(data(result).note).toMatch(/FileOp/)

    // The payoff loop: what was written is what a FileOp would load
    const read = await readAsset('memory', PROJECT, '.agent/joined.csv')
    expect(read.success && read.data).toBe('a,b\n1,2\n')
  })

  it('reads back through read_file', async () => {
    await writeFile({ path: '@/.agent/notes.md', content: '# scratch\n' })
    const result = await readFile({ path: '@/.agent/notes.md' })
    expect(data(result).content).toBe('# scratch\n')
  })

  it('refuses to overwrite the project data', async () => {
    const result = await writeFile({ path: 'trips.csv', content: 'clobbered' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/only allowed inside/)

    const read = await readAsset('memory', PROJECT, 'trips.csv')
    expect(read.success && read.data).toContain('12.5')
  })

  it('keeps the previous contents when it replaces a scratch file', async () => {
    // Not undo — UndoRedoManager snapshots project JSON, not files — but a clobbered
    // scratch file has to be recoverable, and the copy stays inside the sandbox
    await writeFile({ path: '.agent/out.csv', content: 'first\n' })
    const second = await writeFile({ path: '.agent/out.csv', content: 'second\n' })

    expect(data(second).replaced).toBe(true)
    expect(data(second).previousContentsAt).toBe('@/.agent/.previous/out.csv')

    const previous = await readAsset('memory', PROJECT, '.agent/.previous/out.csv')
    expect(previous.success && previous.data).toBe('first\n')
  })

  it('reports no replacement on a first write', async () => {
    const result = await writeFile({ path: '.agent/fresh.csv', content: 'x\n' })
    expect(data(result).replaced).toBeUndefined()
  })

  it('requires string content', async () => {
    const result = await writeFile({ path: '.agent/x.csv', content: 42 as unknown as string })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/string/)
  })

  it('reports read-only storage rather than failing silently', async () => {
    // publicFolder is how a deployed example loads before its assets are copied into
    // memory; writeAsset already refuses, and that refusal has to reach the model
    useFileSystemStore.setState({ activeStorageType: 'publicFolder' })
    const result = await writeFile({ path: '.agent/x.csv', content: 'x' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/public folder/)
  })
})

describe('grep_files', () => {
  it('reports file, line number and matching text', async () => {
    const result = await grepFiles({ pattern: 'Manhattan' })
    expect(result.success).toBe(true)
    expect(data(result).matches).toEqual([
      { file: '@/trips.csv', line: 3, text: '2,31.0,Manhattan' },
    ])
  })

  it('is case-sensitive unless asked otherwise', async () => {
    expect(data(await grepFiles({ pattern: 'manhattan' })).count).toBe(0)
    expect(data(await grepFiles({ pattern: 'manhattan', ignoreCase: true })).count).toBe(1)
  })

  it('returns context lines when asked', async () => {
    const match = (
      data(await grepFiles({ pattern: 'Manhattan', contextLines: 1 })).matches as {
        before: string[]
        after: string[]
      }[]
    )[0]
    expect(match.before).toEqual(['1,12.5,Queens'])
    expect(match.after).toEqual([''])
  })

  it('scopes to a subdirectory', async () => {
    put('raw/other.txt', 'nothing here\n')
    const result = await grepFiles({ pattern: 'nothing', path: 'raw' })
    expect(data(result).count).toBe(2)
    expect(data(await grepFiles({ pattern: 'nothing', path: 'raw' })).filesScanned).toBe(2)
  })

  it('stops at maxResults and says so', async () => {
    put('bulk.csv', Array.from({ length: 100 }, () => 'Queens').join('\n'))
    const result = await grepFiles({ pattern: 'Queens', maxResults: 5 })
    expect(data(result).count).toBe(5)
    expect(data(result).truncated).toMatch(/stopped at 5 matches/)
  })

  it('skips a binary file and reports which', async () => {
    put('tile.png', `PNG${NUL}Queens`)
    const result = await grepFiles({ pattern: 'Queens' })
    expect(data(result).skipped).toEqual(['@/tile.png'])
    expect((data(result).matches as unknown[]).length).toBeGreaterThan(0)
  })

  it('reports an invalid pattern instead of throwing', async () => {
    const result = await grepFiles({ pattern: '([unclosed' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Invalid pattern/)
  })

  it('requires a pattern', async () => {
    const result = await grepFiles({ pattern: '' })
    expect(result.success).toBe(false)
  })
})

// None of these are tier 0, so the only way the model reaches them is find_tools
// scoring their descriptions — a files tool nobody can find is a files tool nobody has
describe('finding the files tools', () => {
  it.each([
    ['what data files does this project have', 'list_files'],
    ['read a csv file', 'read_file'],
    ['save a derived dataset to disk', 'write_file'],
    ['search the data files for a column name', 'grep_files'],
  ])('finds %s → %s', (query, expected) => {
    const top = scoreTools(query)
      .slice(0, 4)
      .map(match => match.name)
    expect(top).toContain(expected)
  })
})

describe('with no project loaded', () => {
  beforeEach(() => {
    useFileSystemStore.setState({ currentProjectName: null })
  })

  it('says so rather than reading someone else’s data directory', async () => {
    for (const result of [
      await listFiles({}),
      await readFile({ path: 'trips.csv' }),
      await writeFile({ path: '.agent/x.csv', content: 'x' }),
      await grepFiles({ pattern: 'x' }),
    ]) {
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/No project is loaded/)
    }
  })
})
