import { runAutoflowCli } from '../packages/autoflow/src/index.js'

void runAutoflowCli().catch((error) => {
  console.error('[autoflow-loop] failed:', error)
  process.exit(1)
})
