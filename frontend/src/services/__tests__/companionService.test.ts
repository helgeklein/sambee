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

describe("companionService.syncLocalization", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    localStorage.setItem("companion_secret", "shared-secret");
  });

  it("sends authenticated localization updates to the companion", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: {
        applied: true,
        language: "en-XA",
        regional_locale: "en-GB",
        updated_at: "2026-03-22T12:00:00.000Z",
        source_origin: "http://localhost:5173",
      },
    });

    const result = await companionService.syncLocalization({
      language: "en-XA",
      regional_locale: "en-GB",
      updated_at: "2026-03-22T12:00:00.000Z",
    });

    expect(result.applied).toBe(true);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      "/localization",
      {
        language: "en-XA",
        regional_locale: "en-GB",
        updated_at: "2026-03-22T12:00:00.000Z",
      },
      {
        headers: expect.objectContaining({
          "X-Companion-Secret": expect.any(String),
          "X-Companion-Timestamp": expect.any(String),
        }),
      }
    );
  });
});
