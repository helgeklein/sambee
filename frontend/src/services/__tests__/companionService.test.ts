import { beforeEach, describe, expect, it, vi } from "vitest";
import companionService, { COMPANION_PAIR_CONFIRMATION_PENDING_DETAIL } from "../companion";

const { mockAxiosInstance } = vi.hoisted(() => ({
  mockAxiosInstance: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    defaults: { baseURL: "http://localhost:21549/api" },
    interceptors: {
      request: { use: vi.fn(), eject: vi.fn() },
      response: { use: vi.fn(), eject: vi.fn() },
    },
  },
}));

vi.mock("axios", () => ({
  default: {
    create: vi.fn(() => mockAxiosInstance),
  },
}));

describe("companionService.confirmPairing", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("retries while the companion is still waiting for local approval", async () => {
    mockAxiosInstance.post
      .mockRejectedValueOnce({ response: { data: { detail: COMPANION_PAIR_CONFIRMATION_PENDING_DETAIL } } })
      .mockRejectedValueOnce({ response: { data: { detail: COMPANION_PAIR_CONFIRMATION_PENDING_DETAIL } } })
      .mockResolvedValueOnce({ data: { secret: "shared-secret" } });

    await companionService.confirmPairing("pair-1");

    expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
    expect(localStorage.getItem("companion_secret")).toBe("shared-secret");
  });

  it("fails immediately for non-retriable confirmation errors", async () => {
    const error = { response: { data: { detail: "Pairing has expired" } } };
    mockAxiosInstance.post.mockRejectedValueOnce(error);

    await expect(companionService.confirmPairing("pair-2")).rejects.toBe(error);
    expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
  });
});
