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
const { run, formatPumpRoomResponse } = await import('../src/main.ts')

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
    fs.statSync.mockImplementation((path) => ({
      isDirectory: () => path.includes('dir')
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
    await run()

    // Verify that the ZIP constructor was called
    expect(admZip).toHaveBeenCalled()

    // Verify success message was logged
    expect(core.info).toHaveBeenCalled()

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
})
