// Conversation compaction utilities for managing long conversation history
import type Anthropic from '@anthropic-ai/sdk'
import type { Message } from './types'

const SUMMARY_SYSTEM_PROMPT = `You are summarizing a conversation to preserve context while reducing length.
Create a concise but complete summary that preserves:
- The user's original request and goals
- Key decisions made during the conversation
- Important technical details and code changes
- Any unfinished tasks or next steps
- Errors encountered and how they were resolved

Format as a structured summary the AI can use to continue the conversation.`

// Estimate token count for a message (rough approximation: 4 chars = 1 token)
export function estimateTokens(content: string | unknown): number {
  const text = typeof content === 'string' ? content : JSON.stringify(content)
  return Math.ceil(text.length / 4)
}

// Estimate total tokens in conversation history
export function estimateConversationTokens(messages: Message[]): number {
  return messages.reduce((total, msg) => {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    return total + estimateTokens(content)
  }, 0)
}

// Check if conversation history should be compacted
export function shouldCompact(messages: Message[], threshold = 50000): boolean {
  return estimateConversationTokens(messages) > threshold
}

// Create a compacted conversation history by summarizing older messages.
// Keeps the most recent messages intact and summarizes earlier context.
export async function compactConversation(
  client: Anthropic,
  messages: Message[],
  model: string,
  keepRecent = 2
): Promise<Message[]> {
  // Keep last N exchanges (2 messages per exchange)
  const recentCount = keepRecent * 2
  if (messages.length <= recentCount) {
    return messages // Nothing to compact
  }

  const messagesToSummarize = messages.slice(0, -recentCount)
  const recentMessages = messages.slice(-recentCount)

  // Format messages for summarization
  const conversationText = messagesToSummarize
    .map(m => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      return `${m.role.toUpperCase()}: ${content}`
    })
    .join('\n\n')

  try {
    // Generate summary using Claude
    const response = await client.messages.create({
      model,
      max_tokens: 2000,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Summarize this conversation history:\n\n${conversationText}`,
        },
      ],
    })

    // Extract summary text
    const summaryText = response.content
      .filter((c): c is Anthropic.TextBlock => c.type === 'text')
      .map(c => c.text)
      .join('\n')

    // Anthropic API requires alternating user/assistant roles.
    // Prepend the summary to the first user message to maintain proper alternation.
    const firstUserIndex = recentMessages.findIndex(m => m.role === 'user')
    if (firstUserIndex === -1) {
      // No user message in recent - just return recent messages
      return recentMessages
    }

    // Create a copy with the summary prepended to the first user message
    const compactedMessages = [...recentMessages]
    const firstUserMsg = compactedMessages[firstUserIndex]
    const originalContent =
      typeof firstUserMsg.content === 'string'
        ? firstUserMsg.content
        : JSON.stringify(firstUserMsg.content)

    compactedMessages[firstUserIndex] = {
      ...firstUserMsg,
      content: `[Previous conversation summary]\n${summaryText}\n\n[Current message]\n${originalContent}`,
    }

    return compactedMessages
  } catch (error) {
    console.error('[Compaction] Failed to generate summary:', error)
    // Fallback: just return recent messages without summary
    return recentMessages
  }
}
