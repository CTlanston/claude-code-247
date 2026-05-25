import { Command } from 'commander'
import { registerInitCommand } from './commands/init.js'
import { registerDaemonCommand } from './commands/daemon.js'
import { registerRepoCommand } from './commands/repo.js'
import { registerMissionCommand } from './commands/mission.js'
import { registerTaskCommand } from './commands/task.js'
import { registerStatusCommand } from './commands/status.js'

export function createCli(): Command {
  const program = new Command()
  program.name('aedev').description('aedev - local-first AI engineering OS').version('0.0.1')
  registerInitCommand(program)
  registerDaemonCommand(program)
  registerRepoCommand(program)
  registerMissionCommand(program)
  registerTaskCommand(program)
  registerStatusCommand(program)
  return program
}
