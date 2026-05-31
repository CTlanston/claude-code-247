import { useEffect, useMemo, useRef, useState } from 'react'

export interface Command {
  id: string
  title: string
  hint?: string
  run: () => void
}

/** ⌘K command palette (Direction A extra). Filter + ↑/↓ + ↵ + esc. */
export function CommandPalette({ open, commands, onClose }: {
  open: boolean
  commands: Command[]
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      const id = setTimeout(() => inputRef.current?.focus(), 0)
      return () => clearTimeout(id)
    }
    return undefined
  }, [open])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter((c) => `${c.title} ${c.hint ?? ''}`.toLowerCase().includes(needle))
  }, [q, commands])

  useEffect(() => { setSel((s) => Math.min(s, Math.max(0, filtered.length - 1))) }, [filtered.length])

  if (!open) return null

  function runAt(i: number) {
    const c = filtered[i]
    if (!c) return
    onClose()
    c.run()
  }

  return (
    <div className="ck-palette-overlay" onMouseDown={onClose}>
      <div className="ck-palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="ck-palette-input"
          placeholder="Type a command · 输入命令…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); runAt(sel) }
            else if (e.key === 'Escape') { e.preventDefault(); onClose() }
          }}
        />
        <div className="ck-palette-list">
          {filtered.length === 0 && <div className="ck-palette-empty">No matching command · 无匹配命令</div>}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              className={`ck-palette-item${i === sel ? ' active' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => runAt(i)}
            >
              <span>{c.title}</span>
              {c.hint && <small>{c.hint}</small>}
            </button>
          ))}
        </div>
        <div className="ck-palette-hint">↑↓ navigate · ↵ run · esc close</div>
      </div>
    </div>
  )
}
