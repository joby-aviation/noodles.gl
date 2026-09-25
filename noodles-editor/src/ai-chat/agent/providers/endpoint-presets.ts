// Starting points for the custom-endpoint form. Every one of these was reachable
// when it was added, with the model id checked against that provider's own
// catalogue — the reason this file exists is that the previous inline preset
// pointed at `llama-3.1-70b-versatile`, which Groq decommissioned, so clicking it
// and pasting a valid key still produced a 404.
//
// A preset is data, not behaviour: the form fills in and the user still presses
// Test and Save, which calls GET /models and refuses to save a model the server
// does not list. That check is what keeps a stale id here from becoming a broken
// chat rather than a visible error.
//
// There is no keyless preset. Every free OpenAI-compatible endpoint that answers
// without a key refuses browser traffic — text.pollinations.ai returns 403 "Missing
// Turnstile token" from a page origin while working fine from curl, and the others
// either 401 or refuse CORS. A keyless path would need a proxy we do not have.
// The three free-key presets below are the closest thing: an account, but no card
// and no wait.

export interface EndpointPreset {
  id: string
  label: string
  baseUrl: string
  model: string
  displayName: string
  // Where the free key comes from
  signupUrl: string
  // Shown under the button, so the cost of the click is legible before it
  note: string
}

export const ENDPOINT_PRESETS: readonly EndpointPreset[] = [
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    displayName: 'Groq (Llama 3.3 70B)',
    signupUrl: 'https://console.groq.com/keys',
    note: 'Free key, no card. Fast, with a daily request cap.',
  },
  {
    id: 'google',
    label: 'Google AI Studio',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.8-flash',
    displayName: 'Gemini 3.8 Flash',
    signupUrl: 'https://aistudio.google.com/apikey',
    note: 'Free key, no card. Large context and native tool calling.',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    model: 'gpt-oss-120b',
    displayName: 'Cerebras (GPT-OSS 120B)',
    signupUrl: 'https://cloud.cerebras.ai/',
    note: 'Free trial tier, no card. The fastest of the three.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    displayName: 'OpenAI (GPT-4o)',
    signupUrl: 'https://platform.openai.com/api-keys',
    note: 'Paid. Needs a card before the key works.',
  },
]
