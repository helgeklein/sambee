import { afterEach, describe, expect, it } from "vitest";
import {
  clearForegroundTransferOperation,
  loadForegroundTransferOperation,
  storeForegroundTransferOperation,
} from "../foregroundTransferOperation";

describe("foreground transfer operation tracking", () => {
  afterEach(() => {
    clearForegroundTransferOperation();
  });

  it("stores an operation with its destination connection scope", () => {
    storeForegroundTransferOperation("operation-a", "destination-a");

    expect(loadForegroundTransferOperation()).toMatchObject({
      operationId: "operation-a",
      destinationConnectionId: "destination-a",
    });
  });

  it("clears only the requested operation", () => {
    storeForegroundTransferOperation("operation-a", "destination-a");

    clearForegroundTransferOperation("operation-b");
    expect(loadForegroundTransferOperation()?.operationId).toBe("operation-a");
    clearForegroundTransferOperation("operation-a");
    expect(loadForegroundTransferOperation()).toBeNull();
  });

  it("removes malformed markers", () => {
    sessionStorage.setItem("sambee:foreground-transfer-operation", "not-json");

    expect(loadForegroundTransferOperation()).toBeNull();
    expect(sessionStorage.getItem("sambee:foreground-transfer-operation")).toBeNull();
  });
});
