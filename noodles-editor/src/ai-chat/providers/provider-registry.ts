import type { ProviderPreference } from '../../noodles/keys-store'
import { getKeysStore } from '../../noodles/keys-store'
import { debugAiChat } from '../../utils/debug'
import type { MCPTools } from '../mcp-tools'
import type { AIProvider } from './ai-provider-interface'
import { ProviderError } from './ai-provider-interface'
import { AnthropicProvider } from './anthropic-provider'
import { ChromeAIProvider } from './chrome-ai-provider'
import { CustomEndpointProvider } from './custom-endpoint-provider'

// Singleton registry for managing AI providers
export class ProviderRegistry {
  private static instance: ProviderRegistry | null = null
  private currentProvider: AIProvider | null = null
  private tools: MCPTools | null = null
  private preference: ProviderPreference = 'automatic'
  private onChromeAIDownloadProgress?: (loaded: number, total: number) => void

  private constructor() {}

  static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry()
    }
    return ProviderRegistry.instance
  }

  // Initialize the registry with MCPTools
  setTools(tools: MCPTools): void {
    this.tools = tools
  }

  // Set user's provider preference
  setPreference(preference: ProviderPreference): void {
    this.preference = preference
    this.currentProvider = null // Force re-selection on next getProvider()
  }

  getPreference(): ProviderPreference {
    return this.preference
  }

  // Set download progress callback for Chrome AI
  setChromeAIDownloadProgress(callback?: (loaded: number, total: number) => void): void {
    this.onChromeAIDownloadProgress = callback
  }

  // Get or create the appropriate provider based on available API keys and user preference
  async getProvider(): Promise<AIProvider> {
    if (!this.tools) {
      throw new ProviderError(
        'ProviderRegistry not initialized with MCPTools',
        'registry',
        'NOT_INITIALIZED'
      )
    }

    // If we have a provider and it matches the current state, reuse it
    if (this.currentProvider && this.isProviderStillValid()) {
      return this.currentProvider
    }

    // Select provider based on preference and available keys
    const provider = await this.selectProvider()

    // Cache only providers that initialize successfully
    await provider.initialize()
    this.currentProvider = provider

    debugAiChat(`Using provider: ${provider.displayName} (${provider.name})`)

    return provider
  }

  // Select provider based on preference and available API keys
  private async selectProvider(): Promise<AIProvider> {
    if (!this.tools) {
      throw new ProviderError('ProviderRegistry not initialized', 'registry', 'NOT_INITIALIZED')
    }

    const keysStore = getKeysStore()
    const anthropicKey = keysStore.getKey('anthropic')
    const customEndpoint = keysStore.getCustomEndpoint()

    switch (this.preference) {
      case 'anthropic':
        if (!anthropicKey) {
          throw new ProviderError(
            'Anthropic API key not configured. Add your key in Settings > API Keys or switch to automatic mode.',
            'anthropic',
            'MISSING_API_KEY'
          )
        }
        return new AnthropicProvider(anthropicKey, this.tools)

      case 'custom':
        if (
          !customEndpoint ||
          !customEndpoint.baseUrl ||
          !customEndpoint.apiKey ||
          !customEndpoint.model
        ) {
          throw new ProviderError(
            'Custom endpoint not configured. Please configure your endpoint in Settings > AI Provider.',
            'custom',
            'MISSING_CONFIG'
          )
        }
        return new CustomEndpointProvider(this.tools, customEndpoint)

      case 'chrome-ai':
        return new ChromeAIProvider(this.tools, {
          onDownloadProgress: this.onChromeAIDownloadProgress
        })

      case 'automatic':
      default:
        // Automatic mode priority:
        // 1. Anthropic Claude (if key available) - best quality
        // 2. Custom endpoint (if configured) - user's choice
        // 3. Chrome Built-in AI (if available) - truly free, no keys

        if (anthropicKey) {
          debugAiChat('Automatic mode: Anthropic key found, using Claude')
          return new AnthropicProvider(anthropicKey, this.tools)
        }

        if (customEndpoint?.baseUrl && customEndpoint?.apiKey && customEndpoint?.model) {
          debugAiChat('Automatic mode: Custom endpoint configured, using it')
          return new CustomEndpointProvider(this.tools, customEndpoint)
        }

        // Fall back to Chrome Built-in AI (truly free, local)
        try {
          debugAiChat('Automatic mode: No keys found, using Chrome Built-in AI (local, free)')
          return new ChromeAIProvider(this.tools, {
            onDownloadProgress: this.onChromeAIDownloadProgress
          })
        } catch (error) {
          // Chrome AI not available - surface the specific error if it's a ProviderError
          if (error instanceof ProviderError) {
            throw error
          }
          // Generic fallback if Chrome AI fails for unknown reason
          throw new ProviderError(
            'No AI provider configured.\n\n' +
              'Add an API key for Anthropic, OpenAI, or another provider to use the Assistant.',
            'registry',
            'NO_PROVIDER_AVAILABLE'
          )
        }
    }
  }

  // Check if current provider is still valid for the current state
  private isProviderStillValid(): boolean {
    if (!this.currentProvider) return false

    const keysStore = getKeysStore()
    const anthropicKey = keysStore.getKey('anthropic')
    const customEndpoint = keysStore.getCustomEndpoint()

    // If preference is explicit, just check that provider matches
    if (this.preference === 'anthropic') {
      return this.currentProvider.name === 'anthropic' && !!anthropicKey
    }
    if (this.preference === 'custom') {
      return (
        this.currentProvider.name === 'custom' &&
        !!customEndpoint?.baseUrl &&
        !!customEndpoint?.apiKey &&
        !!customEndpoint?.model
      )
    }
    if (this.preference === 'chrome-ai') {
      return this.currentProvider.name === 'chrome-ai'
    }

    // Automatic mode: check if we should upgrade/downgrade
    // Priority: Anthropic > Custom > Chrome AI

    // If Anthropic key exists and we're using Anthropic, stay with it
    if (anthropicKey && this.currentProvider.name === 'anthropic') {
      return true
    }

    // If Anthropic key exists but we're using something else, we should upgrade
    if (anthropicKey && this.currentProvider.name !== 'anthropic') {
      return false // Trigger upgrade to Anthropic
    }

    // If custom endpoint configured and we're using it, stay with it
    if (
      customEndpoint?.baseUrl &&
      customEndpoint?.apiKey &&
      customEndpoint?.model &&
      this.currentProvider.name === 'custom'
    ) {
      return true
    }

    // If custom endpoint configured but we're using Chrome AI, upgrade to custom
    if (
      customEndpoint?.baseUrl &&
      customEndpoint?.apiKey &&
      customEndpoint?.model &&
      this.currentProvider.name === 'chrome-ai'
    ) {
      return false // Trigger upgrade to custom
    }

    // If no keys/config and we're using Chrome AI, stay with it
    if (
      !anthropicKey &&
      (!customEndpoint?.baseUrl || !customEndpoint?.apiKey || !customEndpoint?.model) &&
      this.currentProvider.name === 'chrome-ai'
    ) {
      return true
    }

    // Any other state change should trigger re-selection
    return false
  }

  // Get current provider without creating a new one (for display purposes)
  getCurrentProvider(): AIProvider | null {
    return this.currentProvider
  }

  // Reset the registry (useful for testing)
  reset(): void {
    this.currentProvider = null
    this.preference = 'automatic'
    this.tools = null
  }
}

// Export singleton instance helpers
export const getProviderRegistry = () => ProviderRegistry.getInstance()
