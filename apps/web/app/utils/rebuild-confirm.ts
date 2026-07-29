/**
 * Pure guard for the rebuild danger-zone confirmation dialog.
 * Only the exact, case-sensitive string "REBUILD" enables the action.
 */
export function isRebuildConfirmation(input: string): boolean {
  return input === 'REBUILD'
}
