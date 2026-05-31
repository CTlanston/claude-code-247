// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ChatThread } from './ChatThread.js'

afterEach(cleanup)
import type { ApiOperatorMessage } from '../../api.js'

beforeAll(() => { window.HTMLElement.prototype.scrollIntoView = vi.fn() })

const messages: ApiOperatorMessage[] = [
  { id: 'm1', sessionId: 's', role: 'user', content: 'hi', createdAt: '2026-01-01' },
  {
    id: 'm2', sessionId: 's', role: 'assistant', content: '## Plan\n- step one', createdAt: '2026-01-02',
    meta: { provider: 'codex-cli', authMode: 'subscription', agentMode: 'single', inputTokens: 100, outputTokens: 20 },
    questions: [{ id: 'q1', field: 'scope', question: 'Scope?', options: [{ label: 'Small', recommended: true }] }],
  },
]

describe('ChatThread', () => {
  it('renders the transparency footer, markdown, and a clarification card', () => {
    render(<ChatThread messages={messages} busy={null} canChoose={true} onChoice={vi.fn()} onAnswer={vi.fn()} />)
    expect(screen.getByText(/single planner/)).toBeTruthy()
    expect(screen.getByText(/codex-cli/)).toBeTruthy()
    expect(screen.getByText('Plan')).toBeTruthy()   // markdown heading
    expect(screen.getByText('Scope?')).toBeTruthy()  // clarification card
  })

  it('does not fabricate a footer when meta is absent', () => {
    render(<ChatThread messages={[messages[0]!]} busy={null} canChoose={false} onChoice={vi.fn()} onAnswer={vi.fn()} />)
    expect(screen.queryByText(/single planner/)).toBeNull()
  })

  it('shows provider + "tokens pending" during the thinking phase (no token counts yet)', () => {
    const thinking: ApiOperatorMessage[] = [{
      id: 't1', sessionId: 's', role: 'assistant', createdAt: '2026-01-03',
      content: 'Brainstorm is running on the local planner CLI.',
      meta: { provider: 'codex', authMode: 'subscription', agentMode: 'single' }, // no tokens yet
    }]
    render(<ChatThread messages={thinking} busy="create" canChoose={false} onChoice={vi.fn()} onAnswer={vi.fn()} />)
    expect(screen.getByText(/codex/)).toBeTruthy()
    expect(screen.getByText(/tokens pending/)).toBeTruthy()
  })
})
