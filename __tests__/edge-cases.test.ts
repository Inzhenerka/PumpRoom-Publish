/**
 * Unit tests for edge cases and uncovered branches in src/main.ts
 */
import { jest } from '@jest/globals'
import type { Mock } from 'jest-mock'
import * as core from '../__fixtures__/core.js'
import * as fs from '../__fixtures__/fs.js'
import * as path from '../__fixtures__/path.js'
import { axios } from '../__fixtures__/axios.js'
import { FormData, fileFromPath } from '../__fixtures__/formdata-node.js'
import { admZip } from '../__fixtures__/adm-zip.js'

// Mocks should be declared before the module being tested is imported.
jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('fs', () => fs)
jest.unstable_mockModule('path', () => path)
jest.unstable_mockModule('axios', () => ({ default: axios }))
jest.unstable_mockModule('formdata-node', () => ({ FormData }))
jest.unstable_mockModule('formdata-node/file-from-path', () => ({
  fileFromPath
}))
jest.unstable_mockModule('adm-zip', () => ({ default: admZip }))

// Import the module in beforeAll to ensure mocks are set up first
let validateUniqueFolderNames: (rootDir: string) => Promise<void>
let validateInzhenerkaYml: (rootDir: string) => Promise<void>
let run: () => Promise<void>

beforeAll(async () => {
  const mainModule = await import('../src/main.js')
  validateUniqueFolderNames = mainModule.validateUniqueFolderNames
  validateInzhenerkaYml = mainModule.validateInzhenerkaYml
  run = mainModule.run
})

describe('Edge cases in validateUniqueFolderNames', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('Handles unknown error types correctly', async () => {
    // Mock fs.readdirSync to throw a non-Error object
    ;(fs.readdirSync as Mock).mockImplementation(() => {
      throw 'Not an Error object'
    })

    // Expect the function to throw with the unknown error message
    await expect(validateUniqueFolderNames('/mock/dir')).rejects.toThrow(
      'Unknown error during folder validation'
    )
  })
})

describe('Edge cases in validateInzhenerkaYml', () => {
  beforeEach(() => {
    jest.resetAllMocks()

    // Default mock for fs.existsSync and fs.readFileSync
    ;(fs.existsSync as Mock).mockReturnValue(true)
    ;(fs.readFileSync as Mock).mockReturnValue('valid: yaml\ncontent: true')
  })

  it('Handles Axios error without response correctly', async () => {
    // Create a custom error object that will be recognized as an Axios error but without response
    const axiosError = new Error('Network Error') as any
    axiosError.isAxiosError = true
    // No response property

    // Mock axios.isAxiosError to return true for this error
    ;(axios.isAxiosError as Mock).mockImplementation((error: unknown) => {
      return (
        error &&
        typeof error === 'object' &&
        error !== null &&
        'isAxiosError' in error &&
        (error as any).isAxiosError === true
      )
    })

    // Mock axios.post to reject with the error
    ;(axios.post as Mock).mockRejectedValue(axiosError)

    // Expect the function to throw with the error message including the network error
    await expect(validateInzhenerkaYml('/mock/dir')).rejects.toThrow(
      '❌ Configuration validation failed:\nError: Network Error'
    )
  })

  it('Handles unknown error types correctly', async () => {
    // Mock axios.post to throw a non-Error object
    ;(axios.post as Mock).mockRejectedValue('Not an Error object')

    // Mock axios.isAxiosError to return false
    ;(axios.isAxiosError as Mock).mockReturnValue(false)

    // Expect the function to throw with the unknown error message
    await expect(validateInzhenerkaYml('/mock/dir')).rejects.toThrow(
      'Unknown error during configuration validation'
    )
  })
})

describe('Edge cases in run function', () => {
  beforeEach(() => {
    jest.resetAllMocks()

    // Set up core.getInput mocks
    ;(core.getInput as Mock).mockImplementation((name: unknown) => {
      const inputName = name as string
      switch (inputName) {
        case 'root_dir':
          return '' // Empty to test the process.cwd() fallback
        case 'ignore':
          return '' // Empty to test the empty string fallback
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

    // Mock process.cwd
    process.cwd = jest.fn(() => '/mock/cwd') as any
  })

  it('Uses process.cwd() when root_dir is empty', async () => {
    // Mock validateUniqueFolderNames to throw an error so we don't proceed too far
    ;(fs.readdirSync as Mock).mockImplementation(() => {
      throw new Error('Test error')
    })

    // Run the function - it should catch the error internally
    await run()

    // Verify that core.debug was called with the expected root directory
    expect(core.debug).toHaveBeenCalledWith('Root directory: /mock/cwd')
  })

  it('Handles empty ignore input correctly', async () => {
    // Mock validateUniqueFolderNames to throw an error so we don't proceed too far
    ;(fs.readdirSync as Mock).mockImplementation(() => {
      throw new Error('Test error')
    })

    // Run the function - it should catch the error internally
    await run()

    // Verify that core.debug was called with only the default ignore list
    expect(core.debug).toHaveBeenCalledWith('Ignore list: .git, .github')
  })

  it('Handles unknown error types correctly', async () => {
    // Mock validateUniqueFolderNames to throw a non-Error object
    ;(fs.readdirSync as Mock).mockImplementation(() => {
      throw 'Not an Error object'
    })

    // Run the function - it should catch the error internally
    await run()

    // Verify that core.setFailed was called with the unknown error message
    expect(core.setFailed).toHaveBeenCalledWith(
      'Unknown error during folder validation'
    )
  })
})
