// System prompt builder - combines core prompt with runtime context reference

import { generateContextReference } from './generate-context-reference'
import systemPromptTemplate from './prompts/core.md?raw'

let cachedSystemPrompt: string | null = null

// Get the full system prompt with context reference appended
export function getSystemPrompt(): string {
  if (cachedSystemPrompt) {
    return cachedSystemPrompt
  }

  // Generate compact context reference and append to core prompt
  const contextReference = generateContextReference()
  cachedSystemPrompt = systemPromptTemplate + contextReference

  return cachedSystemPrompt
}

// Clear cache (useful for testing)
export function clearSystemPromptCache(): void {
  cachedSystemPrompt = null
}
