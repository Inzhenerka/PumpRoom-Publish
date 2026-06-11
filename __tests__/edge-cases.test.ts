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

let validateUniqueFolderNames: (rootDir: string) => Promise<void>
let validatePumproomYml: (rootDir: string) => Promise<void>
let run: () => Promise<void>

beforeAll(async () => {
  const mainModule = await import('../src/main.js')
  validateUniqueFolderNames = mainModule.validateUniqueFolderNames
  validatePumproomYml = mainModule.validatePumproomYml
  run = mainModule.run
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

describe('Edge cases in validateUniqueFolderNames', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    ;(path.join as Mock).mockImplementation((...args: unknown[]) =>
      (args as string[]).join('/')
    )
  })

  it('propagates non-Error throws as-is', async () => {
    ;(fs.readdirSync as Mock).mockImplementation(() => {
      throw 'Not an Error object'
    })

    await expect(validateUniqueFolderNames('/mock/dir')).rejects.toBe(
      'Not an Error object'
    )
  })
})

describe('Edge cases in validatePumproomYml', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    ;(path.join as Mock).mockImplementation((...args: unknown[]) =>
      (args as string[]).join('/')
    )
    ;(fs.existsSync as Mock).mockReturnValue(true)
    ;(fs.readFileSync as Mock).mockReturnValue('valid: yaml\ncontent: true')
    fetchMock.mockReset()
  })

  it('reports network errors with the original message', async () => {
    fetchMock.mockRejectedValue(new Error('Network Error'))

    await expect(validatePumproomYml('/mock/dir')).rejects.toThrow(
      '❌ Configuration validation failed:\nError: Network Error'
    )
  })

  it('coerces non-Error rejections to a string message', async () => {
    fetchMock.mockRejectedValue('Not an Error object')

    await expect(validatePumproomYml('/mock/dir')).rejects.toThrow(
      '❌ Configuration validation failed:\nError: Not an Error object'
    )
  })
})

describe('Edge cases in run function', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    ;(core.getInput as Mock).mockImplementation((name: unknown) => {
      switch (name as string) {
        case 'root_dir':
          return ''
        case 'ignore':
          return ''
        case 'realm':
          return 'test-realm'
        case 'repo_name':
          return 'test-repo'
        case 'api_key':
          return 'test-api-key'
        default:
          return ''
      }
    })
    process.cwd = jest.fn(() => '/mock/cwd') as unknown as () => string
  })

  it('falls back to process.cwd() when root_dir is empty', async () => {
    ;(fs.readdirSync as Mock).mockImplementation(() => {
      throw new Error('Test error')
    })

    await run()

    expect(core.debug).toHaveBeenCalledWith('Root directory: /mock/cwd')
  })

  it('uses only default ignore list when no user input', async () => {
    ;(fs.readdirSync as Mock).mockImplementation(() => {
      throw new Error('Test error')
    })

    await run()

    expect(core.debug).toHaveBeenCalledWith(
      'Ignore list: .git, .github, .claude'
    )
  })

  it('passes non-Error throws into core.setFailed', async () => {
    ;(fs.readdirSync as Mock).mockImplementation(() => {
      throw 'Not an Error object'
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith('Not an Error object')
  })
})
