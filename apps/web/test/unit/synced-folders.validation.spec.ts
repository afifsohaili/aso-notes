import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { SyncedFolderValidationError, validateSyncedFolderPath } from '../../server/lib/sync/synced-folders'

const tempDirs: string[] = []

function givenTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aso-synced-folders-'))
  tempDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tempDirs)
    rmSync(dir, { recursive: true, force: true })
})

describe('validateSyncedFolderPath', () => {
  it('accepts an absolute directory path and returns the normalized form', () => {
    const dir = givenTempDir()
    expect(validateSyncedFolderPath(dir, [])).toEqual({ normalized: path.resolve(dir) })
  })

  it('rejects a missing path', () => {
    expect(() => validateSyncedFolderPath('/tmp/aso-missing-folder-12345', []))
      .toThrow(SyncedFolderValidationError)
    expect(() => validateSyncedFolderPath('/tmp/aso-missing-folder-12345', []))
      .toThrow('path does not exist or is not accessible')
  })

  it('rejects a relative path', () => {
    expect(() => validateSyncedFolderPath('relative/path', []))
      .toThrow(SyncedFolderValidationError)
    expect(() => validateSyncedFolderPath('relative/path', []))
      .toThrow('path must be absolute')
  })

  it('rejects a non-string path', () => {
    expect(() => validateSyncedFolderPath(null, []))
      .toThrow(SyncedFolderValidationError)
  })

  it('rejects a file path', () => {
    const dir = givenTempDir()
    const file = path.join(dir, 'file.txt')
    writeFileSync(file, 'x')
    expect(() => validateSyncedFolderPath(file, []))
      .toThrow(SyncedFolderValidationError)
    expect(() => validateSyncedFolderPath(file, []))
      .toThrow('path must be a directory')
  })

  it('rejects an already registered path', () => {
    const dir = givenTempDir()
    expect(() => validateSyncedFolderPath(dir, [dir]))
      .toThrow(SyncedFolderValidationError)
    expect(() => validateSyncedFolderPath(dir, [dir]))
      .toThrow('folder already registered')
    expect(() => validateSyncedFolderPath(dir, [`${dir}/`]))
      .toThrow('folder already registered')
  })

  it('rejects a folder nested inside an existing synced folder', () => {
    const root = givenTempDir()
    const nested = path.join(root, 'nested')
    mkdirSync(nested, { recursive: true })
    expect(() => validateSyncedFolderPath(nested, [root]))
      .toThrow(SyncedFolderValidationError)
    expect(() => validateSyncedFolderPath(nested, [root]))
      .toThrow('folder is nested inside an existing synced folder')
  })

  it('rejects a folder that contains an existing synced folder', () => {
    const root = givenTempDir()
    const nested = path.join(root, 'nested')
    mkdirSync(nested, { recursive: true })
    expect(() => validateSyncedFolderPath(root, [nested]))
      .toThrow(SyncedFolderValidationError)
    expect(() => validateSyncedFolderPath(root, [nested]))
      .toThrow('folder contains an existing synced folder')
  })

  it('allows sibling folders that share a prefix', () => {
    const dir = givenTempDir()
    const siblingA = path.join(dir, 'notes-a')
    const siblingB = path.join(dir, 'notes-ab')
    mkdirSync(siblingA, { recursive: true })
    mkdirSync(siblingB, { recursive: true })
    expect(validateSyncedFolderPath(siblingA, [siblingB]).normalized).toBe(siblingA)
    expect(validateSyncedFolderPath(siblingB, [siblingA]).normalized).toBe(siblingB)
  })
})
