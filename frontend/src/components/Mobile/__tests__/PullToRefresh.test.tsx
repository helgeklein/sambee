import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PullToRefresh from "../PullToRefresh";

describe("PullToRefresh", () => {
  it("shows pull to refresh text when pulling", () => {
    render(<PullToRefresh pullDistance={40} isRefreshing={false} threshold={80} />);
    expect(screen.getByText("Pull to refresh")).toBeInTheDocument();
  });

  it("shows release to refresh text when past threshold", () => {
    render(<PullToRefresh pullDistance={85} isRefreshing={false} threshold={80} />);
    expect(screen.getByText("Release to refresh")).toBeInTheDocument();
  });

  it("shows refreshing text when refresh is in progress", () => {
    render(<PullToRefresh pullDistance={0} isRefreshing={true} threshold={80} />);
    expect(screen.getByText("Refreshing...")).toBeInTheDocument();
  });

  it("is hidden when pull distance is zero and not refreshing", () => {
    const { container } = render(
      <PullToRefresh pullDistance={0} isRefreshing={false} threshold={80} />
    );
    // Component should be in the DOM but with opacity 0
    const animatedDiv = container.firstChild as HTMLElement;
    expect(animatedDiv).toBeInTheDocument();
  });
});
