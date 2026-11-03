// Shared utility for detecting if keyboard shortcuts should be blocked
// Used by keyboard-manager and direct event listeners to maintain consistent behavior

const inputTags = ['INPUT', 'SELECT', 'TEXTAREA']

// Check if a keyboard event should be blocked due to input field focus or .nokey container
// This handles:
// - Standard form inputs (INPUT, SELECT, TEXTAREA)
// - contenteditable elements
// - Elements inside .nokey containers
// - Shadow DOM via composedPath()
export function shouldBlockKeyboardShortcut(event: KeyboardEvent): boolean {
  const target = (event.composedPath?.()?.[0] || event.target) as Element | null
  if (target?.nodeType !== 1) return false

  const isInput = inputTags.includes(target.nodeName) || target.hasAttribute('contenteditable')
  return isInput || !!target.closest('.nokey')
}
