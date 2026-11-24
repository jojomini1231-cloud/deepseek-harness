import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { powerShellCandidates } from '../scripts/desktop-toolchain-preflight.ts'

describe('PowerShell resolution', () => {
  it('tries PATH, then the MSI install location, then the app-execution alias', () => {
    expect(powerShellCandidates({
      ProgramFiles: join('C:', 'Program Files'),
      LOCALAPPDATA: join('C:', 'Users', 'builder', 'AppData', 'Local'),
    })).toEqual([
      'pwsh',
      join('C:', 'Program Files', 'PowerShell', '7', 'pwsh.exe'),
      join('C:', 'Users', 'builder', 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'pwsh.exe'),
    ])
  })

  it('tries an explicitly configured executable first without repeating it', () => {
    expect(powerShellCandidates({ DSH_DESKTOP_PWSH: ' D:\\tools\\pwsh.exe ' })).toEqual(['D:\\tools\\pwsh.exe', 'pwsh'])
  })

  it('ignores an empty override and Windows locations this environment does not set', () => {
    expect(powerShellCandidates({ DSH_DESKTOP_PWSH: '   ' })).toEqual(['pwsh'])
  })
})
