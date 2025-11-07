import { render as rtlRender, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";

const theme = createTheme({
	palette: {
		mode: "light",
		primary: {
			main: "#1976d2",
		},
		secondary: {
			main: "#dc004e",
		},
	},
});

interface AllProvidersProps {
	children: React.ReactNode;
}

function AllProviders({ children }: AllProvidersProps) {
	return (
		<ThemeProvider theme={theme}>
			<CssBaseline />
			<BrowserRouter>{children}</BrowserRouter>
		</ThemeProvider>
	);
}

function customRender(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
	return rtlRender(ui, { wrapper: AllProviders, ...options });
}

export * from "@testing-library/react";
export { customRender as render };
