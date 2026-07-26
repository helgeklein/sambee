import { describe, expect, it } from "vitest";
import { getApiErrorMessage, getOidcMappingValidationErrors } from "../apiErrors";

describe("OIDC mapping API errors", () => {
  it("extracts all row-keyed validation errors and their messages", () => {
    const errors = [
      {
        target_user_id: "user-1",
        field: "expected_username",
        error_code: "oidc_mapping_duplicate_username",
        message: "Provider username must be unique",
      },
      {
        target_user_id: "user-2",
        field: "target_user_id",
        error_code: "oidc_mapping_target_unavailable",
        message: "OIDC mapping target is unavailable",
      },
    ];
    const apiError = { response: { data: { detail: { errors } }, status: 409 } };

    expect(getOidcMappingValidationErrors(apiError)).toEqual(errors);
    expect(getApiErrorMessage(apiError, "fallback")).toBe("Provider username must be unique OIDC mapping target is unavailable");
  });
});
