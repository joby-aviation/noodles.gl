/**
 * Register custom Monaco Editor languages
 * This file is imported in the main entry point to ensure
 * languages are registered before Monaco Editor is used
 */

import { loader } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { overpassQL, overpassQLConfig } from './overpass-ql'

let registrationComplete = false

/**
 * Register Overpass QL language with Monaco Editor
 * Can be called multiple times safely - will only register once
 */
export async function registerOverpassQL(monaco: typeof Monaco) {
  if (registrationComplete) return

  try {
    // Check if language is already registered
    const languages = monaco.languages.getLanguages()
    if (languages.some((lang) => lang.id === 'overpass-ql')) {
      registrationComplete = true
      return
    }

    // Register Overpass QL language
    monaco.languages.register({ id: 'overpass-ql' })

    // Set language configuration (brackets, comments, etc.)
    monaco.languages.setLanguageConfiguration('overpass-ql', overpassQLConfig)

    // Set Monarch tokenizer for syntax highlighting
    monaco.languages.setMonarchTokensProvider('overpass-ql', overpassQL)

    registrationComplete = true
    console.log('Registered Overpass QL language with Monaco Editor')
  } catch (error) {
    console.error('Failed to register Overpass QL language:', error)
  }
}

// Configure Monaco loader - register on init
loader.init().then(registerOverpassQL).catch(console.error)
