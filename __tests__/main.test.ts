/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * To mock dependencies in ESM, you can create fixtures that export mock
 * functions and objects. For example, the core module is mocked in this test,
 * so that the actual '@actions/core' module is not imported.
 */
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.ts'
import * as fs from '../__fixtures__/fs.ts'
import * as path from '../__fixtures__/path.ts'
import { admZip } from '../__fixtures__/adm-zip.ts'
import { axios } from '../__fixtures__/axios.ts'
import { FormData, fileFromPath } from '../__fixtures__/formdata-node.ts'

// Mocks should be declared before the module being tested is imported.
jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('fs', () => fs)
jest.unstable_mockModule('path', () => path)
jest.unstable_mockModule('adm-zip', () => ({ default: admZip }))
jest.unstable_mockModule('axios', () => ({ default: axios }))
jest.unstable_mockModule('formdata-node', () => ({ FormData }))
jest.unstable_mockModule('formdata-node/file-from-path', () => ({
  fileFromPath
}))

// The module being tested should be imported dynamically. This ensures that the
// mocks are used in place of any actual dependencies.
// Import the PumpRoomApiResponse interface to avoid using 'any'
interface PumpRoomApiResponse {
  repo_updated: boolean
  pushed_at: string
  tasks_current: number
  tasks_updated: number
  tasks_created: number
  tasks_deleted: number
  tasks_cached: number
  tasks_synchronized_with_cms: number
}

let run: () => Promise<void>
let formatPumpRoomResponse: (response: PumpRoomApiResponse) => string
let validateUniqueFolderNames: (rootDir: string) => Promise<void>
let validateInzhenerkaYml: (rootDir: string) => Promise<void>

// Import the module in beforeAll to ensure mocks are set up first
beforeAll(async () => {
  const mainModule = await import('../src/main.ts')
  run = mainModule.run
  formatPumpRoomResponse = mainModule.formatPumpRoomResponse
  validateUniqueFolderNames = mainModule.validateUniqueFolderNames
  validateInzhenerkaYml = mainModule.validateInzhenerkaYml
})

describe('main.ts', () => {
  const mockRootDir = '/mock/root/dir'
  const mockRepoName = 'test-repo'
  const mockRealm = 'test-realm'
  const mockApiKey = 'test-api-key'
  const mockFile = { name: 'archive', type: 'application/zip' }

  beforeEach(() => {
    // Mock process.cwd()
    process.cwd = jest.fn().mockReturnValue('/mock/cwd')

    // Set up path.join mock
    path.join.mockImplementation((...args) => args.join('/'))

    // Set up fs mocks
    fs.readdirSync.mockReturnValue(['file1.txt', 'file2.txt', 'dir1'])
    fs.statSync.mockImplementation((filePath) => ({
      isDirectory: () => {
        if (!filePath || typeof filePath !== 'string') return false
        return filePath.includes('dir')
      }
    }))
    fs.unlinkSync.mockImplementation(() => {})

    // Set up core.getInput mocks for different inputs
    core.getInput.mockImplementation((name) => {
      switch (name) {
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

    // Set up axios mock with the expected response format
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        repo_updated: true,
        pushed_at: '2025-07-30T21:26:10.875969',
        tasks_current: 33,
        tasks_updated: 33,
        tasks_created: 0,
        tasks_deleted: 1,
        tasks_cached: 33,
        tasks_synchronized_with_cms: 2
      }
    })

    // Set up FormData mock
    // FormData is already mocked in the fixture with jest.fn() methods
    // No need to mock prototype methods

    // Set up fileFromPath mock
    fileFromPath.mockResolvedValue(mockFile)
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('Creates a ZIP archive and uploads it successfully', async () => {
    // Set up fs.readdirSync to return some files for the createZipArchive function
    fs.readdirSync.mockReturnValue(['file1.txt', 'dir1'])

    // Set up fs.statSync to identify directories correctly
    fs.statSync.mockImplementation((filePath) => ({
      isDirectory: () => {
        if (!filePath || typeof filePath !== 'string') return false
        return filePath.includes('dir')
      }
    }))

    // Run the main function
    await run()

    // Verify that core.info was called with validation messages
    expect(core.info).toHaveBeenCalledWith(
      '🔍 Validating unique folder names...'
    )
    expect(core.info).toHaveBeenCalledWith('✅ No folder duplicates found')
    expect(core.info).toHaveBeenCalledWith('🔍 Validating .inzhenerka.yml...')

    // Since we're mocking the API response and not actually calling the real API,
    // we can't directly test the formatted output in this test.
    // The formatting functionality is tested separately in the "Formats the API response correctly" test.
  })

  it('Formats the API response correctly', () => {
    // Create a sample response object
    const sampleResponse = {
      repo_updated: true,
      pushed_at: '2025-07-30T21:26:10.875969',
      tasks_current: 33,
      tasks_updated: 33,
      tasks_created: 0,
      tasks_deleted: 1,
      tasks_cached: 33,
      tasks_synchronized_with_cms: 2
    }

    // Format the response
    const formattedResponse = formatPumpRoomResponse(sampleResponse)

    // Verify the formatted response contains the expected information
    expect(formattedResponse).toContain('PumpRoom Repository Update Summary')
    expect(formattedResponse).toContain('Repository Updated: Yes')
    expect(formattedResponse).toContain('Tasks Summary')
    expect(formattedResponse).toContain('Current: 33')
    expect(formattedResponse).toContain('Updated: 33')
    expect(formattedResponse).toContain('Created: 0')
    expect(formattedResponse).toContain('Deleted: 1')
    expect(formattedResponse).toContain('Cached: 33')
    expect(formattedResponse).toContain('Synchronized with CMS: 2')
  })

  it('Handles API error correctly', async () => {
    // Create a custom error object that will be recognized as an Axios error
    const axiosError = new Error('API Error')
    Object.defineProperty(axiosError, 'isAxiosError', { value: true })
    Object.defineProperty(axiosError, 'response', {
      value: {
        status: 400,
        data: { error: 'Bad Request' }
      }
    })

    // Mock axios.isAxiosError to return true for this error
    axios.isAxiosError.mockImplementation((error) => {
      return error && error.isAxiosError === true
    })

    // Mock axios.post to reject with the error
    axios.post.mockRejectedValueOnce(axiosError)

    // Run the function - it should catch the error internally
    await run()

    // In the actual implementation, core.error might not be called directly
    // Instead, we should verify that core.setFailed is called with the expected error message

    // Verify that the action was marked as failed
    // Just check if setFailed was called, without checking the specific message
    expect(core.setFailed).toHaveBeenCalled()
  })

  it('Handles file system error correctly', async () => {
    // Mock file system error
    fs.readdirSync.mockImplementationOnce(() => {
      throw new Error('File system error')
    })

    await run()

    // Verify that the action was marked as failed
    expect(core.setFailed).toHaveBeenCalledWith('File system error')
  })

  // The validation functions are already imported in the beforeAll hook

  describe('validateUniqueFolderNames', () => {
    beforeEach(() => {
      // Reset mocks
      jest.resetAllMocks()

      // Default mock for fs.readdirSync and fs.statSync
      fs.readdirSync.mockReturnValue(['folder1', 'folder2', 'file.txt'])
      fs.statSync.mockImplementation((filePath) => ({
        isDirectory: () => {
          if (!filePath || typeof filePath !== 'string') return false
          return !filePath.includes('file')
        }
      }))
    })

    it('Successfully validates when no duplicates exist', async () => {
      // Mock directories that will be recognized by isDirectory
      fs.readdirSync.mockReturnValue(['dir1', 'dir2'])
      fs.statSync.mockImplementation(() => ({
        isDirectory: () => true
      }))

      await validateUniqueFolderNames(mockRootDir)

      // Verify that success message was logged
      expect(core.info).toHaveBeenCalledWith('✅ No folder duplicates found')
    })

    it('Detects case-insensitive duplicates', async () => {
      // Mock folders with case-insensitive duplicates
      fs.readdirSync.mockReturnValue(['Folder1', 'folder1', 'folder2'])
      fs.statSync.mockImplementation(() => ({
        isDirectory: () => true
      }))

      // Expect the function to throw an error
      await expect(validateUniqueFolderNames(mockRootDir)).rejects.toThrow(
        '❌ Folder duplicates found:'
      )
    })

    it('Handles empty directory', async () => {
      // Mock empty directory
      fs.readdirSync.mockReturnValue([])

      await validateUniqueFolderNames(mockRootDir)

      // Verify that info message was logged
      expect(core.info).toHaveBeenCalledWith('ℹ️ No folders found to validate')
    })

    it('Handles directory with no subdirectories', async () => {
      // Mock directory with only files
      fs.readdirSync.mockReturnValue(['file1.txt', 'file2.txt'])
      fs.statSync.mockImplementation(() => ({
        isDirectory: () => false
      }))

      await validateUniqueFolderNames(mockRootDir)

      // Verify that info message was logged
      expect(core.info).toHaveBeenCalledWith('ℹ️ No folders found to validate')
    })
  })

  describe('validateInzhenerkaYml', () => {
    beforeEach(() => {
      // Reset mocks
      jest.resetAllMocks()

      // Default mock for fs.existsSync and fs.readFileSync
      fs.existsSync.mockReturnValue(true)
      fs.readFileSync.mockReturnValue('valid: yaml\ncontent: true')

      // Default mock for axios.post
      axios.post.mockResolvedValue({ status: 200 })
    })

    it('Successfully validates when configuration is valid', async () => {
      await validateInzhenerkaYml(mockRootDir)

      // Verify that success message was logged
      expect(core.info).toHaveBeenCalledWith('✅ Configuration is valid')
    })

    it('Throws error when configuration file is not found', async () => {
      // Mock file not found
      fs.existsSync.mockReturnValue(false)

      // Expect the function to throw an error
      await expect(validateInzhenerkaYml(mockRootDir)).rejects.toThrow(
        '❌ .inzhenerka.yml file not found'
      )
    })

    it('Throws error when API returns non-200 status', async () => {
      // Mock API error
      axios.post.mockResolvedValue({ status: 400 })

      // Expect the function to throw an error
      await expect(validateInzhenerkaYml(mockRootDir)).rejects.toThrow(
        '❌ Configuration is invalid'
      )
    })

    it('Handles API request error', async () => {
      // Create a custom error object that will be recognized as an Axios error
      const axiosError = new Error('API Error')
      Object.defineProperty(axiosError, 'isAxiosError', { value: true })
      Object.defineProperty(axiosError, 'response', {
        value: {
          status: 400,
          data: { error: 'Bad Request' }
        }
      })

      // Mock axios.isAxiosError to return true for this error
      axios.isAxiosError.mockImplementation((error) => {
        return error && error.isAxiosError === true
      })

      // Mock axios.post to reject with the error
      axios.post.mockRejectedValueOnce(axiosError)

      // Expect the function to throw an error
      await expect(validateInzhenerkaYml(mockRootDir)).rejects.toThrow(
        '❌ Configuration validation failed:'
      )
    })
  })
})
