import { jest } from '@jest/globals'

export const axios = {
  post: jest.fn(),
  isAxiosError: jest.fn().mockImplementation((error) => {
    return error && error.isAxiosError === true
  })
}
