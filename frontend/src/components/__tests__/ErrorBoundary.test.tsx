import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n";
import ErrorBoundary from "../ErrorBoundary";

function ThrowingComponent() {
  throw new Error("Boom");
}

describe("ErrorBoundary", () => {
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    consoleErrorSpy.mockClear();
  });

  afterEach(async () => {
    await setLocale("en");
  });

  it("renders the default fallback UI", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("An unexpected error occurred. The error has been logged.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload Page" })).toBeInTheDocument();
    expect(screen.getByText("Boom")).toBeInTheDocument();
  });

  it("uses translated fallback strings", async () => {
    await setLocale("en-XA");

    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText("[Šóḿéťħíńğ ŵéńť ŵŕóńğ]")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "[Ťŕý Åğåíń]" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "[Ŕéĺóåď Ṕåğé]" })).toBeInTheDocument();
  });
});
