// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ClarificationCard } from './ClarificationCard.js'

afterEach(cleanup)
import type { ApiOperatorQuestion } from '../../api.js'

const questions: ApiOperatorQuestion[] = [
  { id: 'q1', field: 'scope', question: 'Scope?', options: [{ label: 'Small', recommended: true }, { label: 'Big' }] },
  { id: 'q2', field: 'target', question: 'Target?', options: [{ label: 'Docs', value: 'docs' }, { label: 'Code', value: 'code', recommended: true }] },
]

describe('ClarificationCard', () => {
  it('renders questions, marks recommended, and submits recommended defaults', () => {
    const onSubmit = vi.fn()
    render(<ClarificationCard questions={questions} answered={false} busy={null} onSubmit={onSubmit} />)
    expect(screen.getByText('Scope?')).toBeTruthy()
    expect(screen.getByText('Target?')).toBeTruthy()
    expect(screen.getAllByText(/★/)).toHaveLength(2)
    fireEvent.click(screen.getByText(/Answer all/))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]![0]).toEqual([
      { questionId: 'q1', value: 'Small' }, // recommended label (no explicit value)
      { questionId: 'q2', value: 'code' },  // recommended explicit value
    ])
  })

  it('lets the user override the recommended option', () => {
    const onSubmit = vi.fn()
    render(<ClarificationCard questions={[questions[0]!]} answered={false} busy={null} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText('Big'))
    fireEvent.click(screen.getByText(/Answer all/))
    expect(onSubmit.mock.calls[0]![0]).toEqual([{ questionId: 'q1', value: 'Big' }])
  })

  it('shows the answered state instead of inputs', () => {
    render(<ClarificationCard questions={questions} answered={true} busy={null} onSubmit={vi.fn()} />)
    expect(screen.getByText(/Answered/)).toBeTruthy()
    expect(screen.queryByText(/Answer all/)).toBeNull()
  })
})
