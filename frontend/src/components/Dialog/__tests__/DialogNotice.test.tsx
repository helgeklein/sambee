import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DialogNotice, DialogNoticeRegion } from "../DialogNotice";

describe("DialogNotice", () => {
  it("does not render when its message is absent", () => {
    render(<DialogNotice message={null} testId="dialog-notice" />);

    expect(screen.queryByTestId("dialog-notice")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses the default alert role for errors", () => {
    render(<DialogNotice message="Unable to save changes." testId="dialog-notice" />);

    expect(screen.getByTestId("dialog-notice")).toHaveAttribute("role", "alert");
  });

  it("uses a status role for warnings", () => {
    render(<DialogNotice message="Some changes need attention." severity="warning" testId="dialog-notice" />);

    expect(screen.getByTestId("dialog-notice")).toHaveAttribute("role", "status");
  });
});

describe("DialogNoticeRegion", () => {
  it("does not render when every message is absent", () => {
    render(<DialogNoticeRegion testId="dialog-notice-region" notices={[{ message: null }, { message: undefined }]} />);

    expect(screen.queryByTestId("dialog-notice-region")).not.toBeInTheDocument();
  });

  it("renders only active notices", () => {
    render(
      <DialogNoticeRegion
        testId="dialog-notice-region"
        notices={[
          { message: null, testId: "inactive-notice" },
          { message: "Unable to save changes.", testId: "active-notice" },
        ]}
      />
    );

    expect(screen.getByTestId("dialog-notice-region")).toBeInTheDocument();
    expect(screen.queryByTestId("inactive-notice")).not.toBeInTheDocument();
    expect(screen.getByTestId("active-notice")).toHaveAttribute("role", "alert");
  });
});
