import { jest } from '@jest/globals'

// Create mock functions for the AdmZip methods
const addLocalFileMock = jest.fn()
const writeZipMock = jest.fn()

// Export the mock constructor
export const admZip = jest.fn().mockImplementation(() => {
  return {
    addLocalFile: addLocalFileMock,
    writeZip: writeZipMock
  }
})

// Make the mock functions accessible on the constructor for test verification
admZip.addLocalFile = addLocalFileMock
admZip.writeZip = writeZipMock
