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

let resolveSourceRef: (override: string) => string
let run: () => Promise<void>
let formatPumpRoomResponse: (response: PumpRoomApiResponse) => string
let validateUniqueFolderNames: (rootDir: string) => Promise<void>
let validatePumproomYml: (rootDir: string) => Promise<void>

beforeAll(async () => {
  const mainModule = await import('../src/main.js')
  resolveSourceRef = mainModule.resolveSourceRef
  run = mainModule.run
  formatPumpRoomResponse = mainModule.formatPumpRoomResponse
  validateUniqueFolderNames = mainModule.validateUniqueFolderNames
  validatePumproomYml = mainModule.validatePumproomYml
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
    tasks_restored: 0,
    tasks_unchanged: 0,
    tasks_skipped: 1,
    skipped: [{ name: 'manual', reason: 'managed_by_admin' }]
  }

  beforeEach(() => {
    admZip.mockImplementation(() => ({
      addLocalFile: admZip.addLocalFile,
      writeZip: admZip.writeZip
    }))
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
        case 'source_ref':
          return 'https://github.com/example/tasks'
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
    expect(core.info).toHaveBeenCalledWith('🔍 Validating .pumproom.yml...')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://pumproom-api.inzhenerka-cloud.com/schema/configs'
    )
    const form = fetchMock.mock.calls[1][1]?.body as FormData
    expect(form.get('source_ref')).toBe('https://github.com/example/tasks')
    expect(form.get('overwrite')).toBeNull()
    expect(form.get('delete_missing')).toBeNull()
    expect(form.get('managed_by')).toBeNull()
    expect(form.get('force_update')).toBe('false')
    expect(form.has('retain_deleted')).toBe(false)
    expect(fs.unlinkSync).toHaveBeenCalled()
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it.each(['   ', ' git:course '])(
    'preserves source_ref input %j through upload for API validation',
    async (sourceRef) => {
      const defaultInput = core.getInput.getMockImplementation()!
      core.getInput.mockImplementation((name, options) => {
        if (name === 'source_ref')
          return options?.trimWhitespace === false ? sourceRef : sourceRef.trim()
        return defaultInput(name, options)
      })
      ;(fs.readdirSync as Mock).mockReturnValue([])

      await run()

      expect(core.getInput).toHaveBeenCalledWith('source_ref', {
        trimWhitespace: false
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const form = fetchMock.mock.calls[1][1]?.body as FormData
      expect(form.get('source_ref')).toBe(sourceRef)
      expect(core.setFailed).not.toHaveBeenCalled()
    }
  )

  it('formats the API response correctly', () => {
    const formatted = formatPumpRoomResponse(sampleResponse)
    expect(formatted).toContain('PumpRoom Repository Update Summary')
    expect(formatted).toContain('Pushed At:')
    expect(formatted).toContain('Tasks Summary')
    expect(formatted).toContain('Uploaded: 33')
    expect(formatted).toContain('Created: 0')
    expect(formatted).toContain('Updated: 33')
    expect(formatted).toContain('Deleted: 1')
    expect(formatted).toContain('Skipped: 1')
    expect(formatted).toContain('manual: managed_by_admin')
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

  describe('validatePumproomYml', () => {
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
      await validatePumproomYml(mockRootDir)

      expect(core.info).toHaveBeenCalledWith('✅ Configuration is valid')
    })

    it('throws when configuration file is not found', async () => {
      ;(fs.existsSync as Mock).mockReturnValue(false)

      await expect(validatePumproomYml(mockRootDir)).rejects.toThrow(
        '❌ .pumproom.yml file not found'
      )
    })

    it('throws when API returns non-200 status', async () => {
      fetchMock.mockResolvedValue(jsonResponse('Bad Request', 400))

      await expect(validatePumproomYml(mockRootDir)).rejects.toThrow(
        '❌ Configuration validation failed:'
      )
    })

    it('throws when fetch rejects', async () => {
      fetchMock.mockRejectedValue(new Error('Network Error'))

      await expect(validatePumproomYml(mockRootDir)).rejects.toThrow(
        '❌ Configuration validation failed:\nError: Network Error'
      )
    })
  })
})

describe('source reference identity', () => {
  it('derives the workflow repository and supports another checkout override', () => {
    const oldRepo = process.env.GITHUB_REPOSITORY
    const oldServer = process.env.GITHUB_SERVER_URL
    try {
      process.env.GITHUB_REPOSITORY = 'org/repo'
      process.env.GITHUB_SERVER_URL = 'https://git.example.com'
      expect(resolveSourceRef('')).toBe('https://git.example.com/org/repo')
      expect(resolveSourceRef('https://github.com/other/tasks.git/')).toBe(
        'https://github.com/other/tasks.git/'
      )
    } finally {
      if (oldRepo === undefined) delete process.env.GITHUB_REPOSITORY
      else process.env.GITHUB_REPOSITORY = oldRepo
      if (oldServer === undefined) delete process.env.GITHUB_SERVER_URL
      else process.env.GITHUB_SERVER_URL = oldServer
    }
  })

  it.each([' whitespace ', 'line\nbreak', 'x'.repeat(2049)])(
    'passes explicit identifiers verbatim for API validation: %s',
    (url) => {
      expect(resolveSourceRef(url)).toBe(url)
    }
  )
})
