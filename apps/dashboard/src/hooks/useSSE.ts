import { useEffect, useRef, useState } from 'react'
import type { ApiMission, ApiTask } from '../api.js'

export interface SseState {
  connected: boolean
  missions: ApiMission[]
  tasks: ApiTask[]
  pendingApprovals: number
}

export function useSSE(url: string): SseState {
  const [state, setState] = useState<SseState>({
    connected: false, missions: [], tasks: [], pendingApprovals: 0,
  })
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource(url)
    esRef.current = es
    es.addEventListener('connected', () => setState((s) => ({ ...s, connected: true })))
    es.addEventListener('state', (e: MessageEvent) => {
      const d = JSON.parse(e.data as string) as Omit<SseState, 'connected'>
      setState((s) => ({ ...s, ...d }))
    })
    es.onerror = () => setState((s) => ({ ...s, connected: false }))
    return () => { es.close(); esRef.current = null }
  }, [url])

  return state
}
