import { jest } from '@jest/globals'
import type { Mock } from 'jest-mock'
import * as core from '../__fixtures__/core.js'
import * as fs from '../__fixtures__/fs.js'
import * as os from '../__fixtures__/os.js'
import * as path from '../__fixtures__/path.js'
import { admZip } from '../__fixtures__/adm-zip.js'

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('fs', () => fs)
jest.unstable_mockModule('os', () => os)
jest.unstable_mockModule('path', () => path)
jest.unstable_mockModule('adm-zip', () => ({ default: admZip }))

const fetchMock = jest.fn<typeof fetch>()
const originalFetch = globalThis.fetch
globalThis.fetch = fetchMock as unknown as typeof fetch

import type { PumpRoomApiResponse } from '../src/main.js'

let run: () => Promise<void>
let formatPumpRoomResponse: (response: PumpRoomApiResponse) => string
let validateUniqueFolderNames: (rootDir: string) => Promise<void>
let validateInzhenerkaYml: (rootDir: string) => Promise<void>

beforeAll(async () => {
  const mainModule = await import('../src/main.js')
  run = mainModule.run
  formatPumpRoomResponse = mainModule.formatPumpRoomResponse
  validateUniqueFolderNames = mainModule.validateUniqueFolderNames
  validateInzhenerkaYml = mainModule.validateInzhenerkaYml
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data))
  } as unknown as Response
}

describe('main.ts', () => {
  const mockRootDir = '/mock/root/dir'
  const mockRepoName = 'test-repo'
  const mockRealm = 'test-realm'
  const mockApiKey = 'test-api-key'

  const sampleResponse: PumpRoomApiResponse = {
    pushed_at: '2025-07-30T21:26:10.875969',
    tasks_uploaded: 33,
    tasks_created: 0,
    tasks_updated: 33,
    tasks_deleted: 1,
    tasks_retained: 32
  }

  beforeEach(() => {
    process.cwd = jest.fn(() => '/mock/cwd') as Mock<() => string>
    ;(path.join as Mock).mockImplementation((...args: unknown[]) =>
      (args as string[]).join('/')
    )
    ;(path.dirname as Mock).mockImplementation((p: unknown) => {
      const s = p as string
      const idx = s.lastIndexOf('/')
      return idx >= 0 ? s.slice(0, idx) : '.'
    })
    ;(path.basename as Mock).mockImplementation((p: unknown) => {
      const s = p as string
      const idx = s.lastIndexOf('/')
      return idx >= 0 ? s.slice(idx + 1) : s
    })
    ;(os.tmpdir as Mock).mockReturnValue('/tmp')
    ;(fs.readdirSync as Mock).mockReturnValue([
      'file1.txt',
      'file2.txt',
      'dir1'
    ])
    ;(fs.statSync as Mock).mockImplementation((filePath: unknown) => ({
      isDirectory: () => {
        if (typeof filePath !== 'string') return false
        return filePath.includes('dir')
      }
    }))
    ;(fs.unlinkSync as Mock).mockImplementation(() => {})
    ;(fs.existsSync as Mock).mockReturnValue(true)
    ;(fs.readFileSync as Mock).mockReturnValue(Buffer.from('zip-content'))
    ;(core.getInput as Mock).mockImplementation((name: unknown) => {
      switch (name as string) {
        case 'root_dir':
          return mockRootDir
        case 'ignore':
          return 'node_modules,dist'
        case 'realm':
          return mockRealm
        case 'repo_name':
          return mockRepoName
        case 'api_key':
          return mockApiKey
        default:
          return ''
      }
    })
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(jsonResponse(sampleResponse))
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('runs validation and upload successfully', async () => {
    // Bounded mocks so createZipArchive's recursion terminates.
    ;(fs.readdirSync as Mock)
      .mockReturnValueOnce(['file1.txt', 'dir1']) // validateUniqueFolderNames
      .mockReturnValueOnce(['file1.txt', 'dir1']) // createZipArchive root
      .mockReturnValueOnce(['nested.txt']) // createZipArchive dir1
    ;(fs.statSync as Mock).mockImplementation((p: unknown) => ({
      isDirectory: () => typeof p === 'string' && p.endsWith('/dir1')
    }))

    await run()

    expect(core.info).toHaveBeenCalledWith(
      '🔍 Validating unique folder names...'
    )
    expect(core.info).toHaveBeenCalledWith('🔍 Validating .inzhenerka.yml...')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fs.unlinkSync).toHaveBeenCalled()
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('formats the API response correctly', () => {
    const formatted = formatPumpRoomResponse(sampleResponse)
    expect(formatted).toContain('PumpRoom Repository Update Summary')
    expect(formatted).toContain('Pushed At:')
    expect(formatted).toContain('Tasks Summary')
    expect(formatted).toContain('Uploaded: 33')
    expect(formatted).toContain('Created: 0')
    expect(formatted).toContain('Updated: 33')
    expect(formatted).toContain('Deleted: 1')
    expect(formatted).toContain('Retained: 32')
  })

  it('marks the action failed when upload returns non-200, and cleans up', async () => {
    ;(fs.readdirSync as Mock)
      .mockReturnValueOnce(['file1.txt', 'dir1']) // validateUniqueFolderNames
      .mockReturnValueOnce(['file1.txt', 'dir1']) // createZipArchive root
      .mockReturnValueOnce(['nested.txt']) // createZipArchive dir1
    ;(fs.statSync as Mock).mockImplementation((p: unknown) => ({
      isDirectory: () => typeof p === 'string' && p.endsWith('/dir1')
    }))
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ valid: true }))
      .mockResolvedValue(jsonResponse({ error: 'Bad Request' }, 400))

    await run()

    expect(core.setFailed).toHaveBeenCalled()
    expect(fs.unlinkSync).toHaveBeenCalled()
  })

  it('marks the action failed on file system error', async () => {
    ;(fs.readdirSync as Mock).mockImplementationOnce(() => {
      throw new Error('File system error')
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith('File system error')
  })

  describe('validateUniqueFolderNames', () => {
    beforeEach(() => {
      jest.resetAllMocks()
      ;(path.join as Mock).mockImplementation((...args: unknown[]) =>
        (args as string[]).join('/')
      )
      ;(fs.readdirSync as Mock).mockReturnValue([
        'folder1',
        'folder2',
        'file.txt'
      ])
      ;(fs.statSync as Mock).mockImplementation((filePath: unknown) => ({
        isDirectory: () => {
          if (typeof filePath !== 'string') return false
          return !filePath.includes('file')
        }
      }))
    })

    it('passes when no duplicates exist', async () => {
      ;(fs.readdirSync as Mock).mockReturnValue(['dir1', 'dir2'])
      ;(fs.statSync as Mock).mockImplementation(() => ({
        isDirectory: () => true
      }))

      await validateUniqueFolderNames(mockRootDir)

      expect(core.info).toHaveBeenCalledWith('✅ No folder duplicates found')
    })

    it('detects case-insensitive duplicates', async () => {
      ;(fs.readdirSync as Mock).mockReturnValue([
        'Folder1',
        'folder1',
        'folder2'
      ])
      ;(fs.statSync as Mock).mockImplementation(() => ({
        isDirectory: () => true
      }))

      await expect(validateUniqueFolderNames(mockRootDir)).rejects.toThrow(
        '❌ Folder duplicates found:'
      )
    })

    it('handles empty directory', async () => {
      ;(fs.readdirSync as Mock).mockReturnValue([])

      await validateUniqueFolderNames(mockRootDir)

      expect(core.info).toHaveBeenCalledWith('ℹ️ No folders found to validate')
    })

    it('handles directory with no subdirectories', async () => {
      ;(fs.readdirSync as Mock).mockReturnValue(['file1.txt', 'file2.txt'])
      ;(fs.statSync as Mock).mockImplementation(() => ({
        isDirectory: () => false
      }))

      await validateUniqueFolderNames(mockRootDir)

      expect(core.info).toHaveBeenCalledWith('ℹ️ No folders found to validate')
    })
  })

  describe('validateInzhenerkaYml', () => {
    beforeEach(() => {
      jest.resetAllMocks()
      ;(path.join as Mock).mockImplementation((...args: unknown[]) =>
        (args as string[]).join('/')
      )
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockReturnValue('valid: yaml\ncontent: true')
      fetchMock.mockReset()
      fetchMock.mockResolvedValue(jsonResponse({ valid: true }))
    })

    it('passes when configuration is valid', async () => {
      await validateInzhenerkaYml(mockRootDir)

      expect(core.info).toHaveBeenCalledWith('✅ Configuration is valid')
    })

    it('throws when configuration file is not found', async () => {
      ;(fs.existsSync as Mock).mockReturnValue(false)

      await expect(validateInzhenerkaYml(mockRootDir)).rejects.toThrow(
        '❌ .inzhenerka.yml file not found'
      )
    })

    it('throws when API returns non-200 status', async () => {
      fetchMock.mockResolvedValue(jsonResponse('Bad Request', 400))

      await expect(validateInzhenerkaYml(mockRootDir)).rejects.toThrow(
        '❌ Configuration validation failed:'
      )
    })

    it('throws when fetch rejects', async () => {
      fetchMock.mockRejectedValue(new Error('Network Error'))

      await expect(validateInzhenerkaYml(mockRootDir)).rejects.toThrow(
        '❌ Configuration validation failed:\nError: Network Error'
      )
    })
  })
})
