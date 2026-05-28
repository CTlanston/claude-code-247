import { Command } from 'commander'
import { registerInitCommand } from './commands/init.js'
import { registerDaemonCommand } from './commands/daemon.js'
import { registerRepoCommand } from './commands/repo.js'
import { registerMissionCommand } from './commands/mission.js'
import { registerTaskCommand } from './commands/task.js'
import { registerStatusCommand } from './commands/status.js'
import { registerIntakeCommand } from './commands/intake.js'
import { registerBrainstormCommand } from './commands/brainstorm.js'
import { registerGitHubCommand } from './commands/github.js'
import { registerMemoryCommand } from './commands/memory.js'
import { registerDoctorCommand } from './commands/doctor.js'
import { registerPreviewCommand } from './commands/preview.js'
import { registerReleaseCommand } from './commands/release.js'
import { registerSecretsCommand } from './commands/secrets.js'

export function createCli(): Command {
  const program = new Command()
  program.name('aedev').description('aedev - local-first AI engineering OS').version('0.0.1')
  registerInitCommand(program)
  registerDoctorCommand(program)
  registerDaemonCommand(program)
  registerRepoCommand(program)
  registerMissionCommand(program)
  registerTaskCommand(program)
  registerStatusCommand(program)
  registerBrainstormCommand(program)
  registerIntakeCommand(program)
  registerGitHubCommand(program)
  registerMemoryCommand(program)
  registerPreviewCommand(program)
  registerReleaseCommand(program)
  registerSecretsCommand(program)
  return program
}
