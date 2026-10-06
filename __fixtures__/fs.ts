import { vi } from "vitest";

export const readdirSync = vi.fn();
export const statSync = vi.fn();
export const unlinkSync = vi.fn();
export const existsSync = vi.fn();
export const readFileSync = vi.fn();
