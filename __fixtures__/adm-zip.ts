import { vi } from "vitest";

export const admZip = Object.assign(
  vi.fn(function () {
    return { addLocalFile: admZip.addLocalFile, writeZip: admZip.writeZip };
  }),
  { addLocalFile: vi.fn(), writeZip: vi.fn() },
);
