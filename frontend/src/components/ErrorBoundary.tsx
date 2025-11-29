import { Alert, Box, Button, Container, Typography } from "@mui/material";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { logger } from "../services/logger";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

/**
 * Error boundary component that catches React errors and logs them.
 *
 * Displays a user-friendly error message and provides recovery options.
 */
class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log the error with full context
    logger.error("React error boundary caught error", {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
      componentStack: errorInfo.componentStack,
      location: window.location.href,
    });

    // Store error info in state for display
    this.setState({ errorInfo });
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <Container maxWidth="md" sx={{ mt: 4 }}>
          <Alert severity="error" sx={{ mb: 2 }}>
            <Typography variant="h6" gutterBottom>
              Something went wrong
            </Typography>
            <Typography variant="body2" gutterBottom>
              An unexpected error occurred. The error has been logged.
            </Typography>
            {this.state.error && (
              <Typography variant="body2" sx={{ mt: 2, fontFamily: "monospace", fontSize: "0.875rem" }}>
                {this.state.error.message}
              </Typography>
            )}
          </Alert>

          <Box sx={{ display: "flex", gap: 2 }}>
            <Button variant="contained" onClick={this.handleReset}>
              Try Again
            </Button>
            <Button variant="outlined" onClick={this.handleReload}>
              Reload Page
            </Button>
          </Box>

          {import.meta.env.DEV && this.state.errorInfo && (
            <Box sx={{ mt: 4 }}>
              <Typography variant="h6" gutterBottom>
                Error Details (Development Only)
              </Typography>
              <Box
                component="pre"
                sx={{
                  p: 2,
                  bgcolor: "grey.100",
                  borderRadius: 1,
                  overflow: "auto",
                  fontSize: "0.75rem",
                }}
              >
                {this.state.error?.stack}
              </Box>
              <Box
                component="pre"
                sx={{
                  p: 2,
                  bgcolor: "grey.100",
                  borderRadius: 1,
                  overflow: "auto",
                  fontSize: "0.75rem",
                  mt: 2,
                }}
              >
                {this.state.errorInfo.componentStack}
              </Box>
            </Box>
          )}
        </Container>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
