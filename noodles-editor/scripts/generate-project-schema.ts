// Writes the noodles.json JSON Schemas to website/static/schema/, which the site serves at
// https://noodles.gl/schema/: noodles-project.schema.json for the current document version,
// noodles-document.v<N>.schema.json pinned to it, and noodles-project.v<N>.schema.json for
// the last operator-graph project version. Later versions leave each pinned file in place,
// so a file can keep pointing at the version it was written for.
//
//   npm run generate:schema              # write the files
//   npm run generate:schema -- --check   # exit 1 if they are missing or stale (CI)

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DOCUMENT_VERSION,
  documentJsonSchema,
  documentSchemaFileName,
  projectJsonSchema,
  schemaFileName,
} from '../src/noodles/utils/project-schema'

export const SCHEMA_DIR = join(import.meta.dirname, '../../website/static/schema')
const LATEST_FILE = join(import.meta.dirname, '../src/noodles/__migrations__/LATEST')

// The newest migration's number is the last operator-graph project version.
// migration-numbering.test.ts keeps LATEST in step with the migrations folder.
export function currentVersion(latest = readFileSync(LATEST_FILE, 'utf8')): number {
  const version = Number(latest.trim().match(/^\d+/)?.[0])
  if (!Number.isInteger(version)) throw new Error(`Can't read a version from LATEST: ${latest}`)
  return version
}

// `version` is the operator-graph project version, `docVersion` the document's
export function schemaFiles(version: number, docVersion = DOCUMENT_VERSION): Map<string, string> {
  const toJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
  return new Map([
    [schemaFileName(), toJson(documentJsonSchema(docVersion))],
    [
      documentSchemaFileName(docVersion),
      toJson(documentJsonSchema(docVersion, { versioned: true })),
    ],
    [schemaFileName(version), toJson(projectJsonSchema(version))],
  ])
}

// Names of the files that don't match what this checkout generates
export function staleSchemaFiles(dir: string, version: number): string[] {
  return [...schemaFiles(version)]
    .filter(([name, contents]) => {
      try {
        return readFileSync(join(dir, name), 'utf8') !== contents
      } catch {
        return true
      }
    })
    .map(([name]) => name)
}

function main(args: string[]) {
  const version = currentVersion()
  if (args.includes('--check')) {
    const stale = staleSchemaFiles(SCHEMA_DIR, version)
    if (stale.length > 0) {
      console.error(
        `The project schema is out of date: ${stale.join(', ')}. Run "npm run generate:schema" from noodles-editor/ and commit website/static/schema/.`
      )
      process.exit(1)
    }
    console.log(`Project schema is up to date (document version ${DOCUMENT_VERSION})`)
    return
  }
  mkdirSync(SCHEMA_DIR, { recursive: true })
  for (const [name, contents] of schemaFiles(version)) {
    writeFileSync(join(SCHEMA_DIR, name), contents)
    console.log(`Wrote website/static/schema/${name}`)
  }
}

if (import.meta.main) main(process.argv.slice(2))
