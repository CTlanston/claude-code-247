import { useState } from 'react'
import { MissionsPage } from './pages/Missions.js'
import { TasksPage } from './pages/Tasks.js'
import { ApprovalsPage } from './pages/Approvals.js'
import { MemoryPage } from './pages/Memory.js'
import { useSSE } from './hooks/useSSE.js'

type Tab = 'missions' | 'tasks' | 'approvals' | 'memory'
const TABS: Tab[] = ['missions', 'tasks', 'approvals', 'memory']

export function App() {
  const [tab, setTab] = useState<Tab>('missions')
  const { connected } = useSSE('/api/events/stream')
  return (
    <div>
      <nav>
        <span style={{ padding: '10px 16px', fontSize: 13, color: '#64748b' }}>
          <span className={`dot${connected ? '' : ' off'}`} />
          aedev
        </span>
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      <div className="page">
        {tab === 'missions' && <MissionsPage />}
        {tab === 'tasks' && <TasksPage />}
        {tab === 'approvals' && <ApprovalsPage />}
        {tab === 'memory' && <MemoryPage />}
      </div>
    </div>
  )
}
