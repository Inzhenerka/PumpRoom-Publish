import { jest } from '@jest/globals'

export class FormData {
  append = jest.fn()
  getHeaders = jest.fn()
}

export const fileFromPath = jest.fn()
