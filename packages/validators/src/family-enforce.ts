export type ValidatorFamily = 'anthropic' | 'openai' | 'google' | 'mock'

export class FamilyConflictError extends Error {
  constructor(family: ValidatorFamily) {
    super(`validator family ${family} conflicts with reviewer family`)
    this.name = 'FamilyConflictError'
  }
}

export function assertDifferentFamily(reviewer: ValidatorFamily, validator: ValidatorFamily): void {
  if (reviewer === validator && reviewer !== 'mock') throw new FamilyConflictError(validator)
}
