import { lazy, type ReactNode, Suspense } from "react";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AppShell } from "./components/layout";
import { EmptyState, PageSkeleton } from "./components/states";
import { Button } from "./components/ui/button";
import { ThemeProvider, useTheme } from "./lib/theme";

// Route-level code splitting keeps the initial bundle small; chart code loads with the pages that use it.
const OverviewPage = lazy(() => import("./pages/overview").then((m) => ({ default: m.OverviewPage })));
const NewBenchmarkPage = lazy(() => import("./pages/new-benchmark").then((m) => ({ default: m.NewBenchmarkPage })));
const RunPage = lazy(() => import("./pages/run").then((m) => ({ default: m.RunPage })));
const HistoryPage = lazy(() => import("./pages/history").then((m) => ({ default: m.HistoryPage })));
const ComparePage = lazy(() => import("./pages/compare").then((m) => ({ default: m.ComparePage })));
const RuntimesPage = lazy(() => import("./pages/runtimes").then((m) => ({ default: m.RuntimesPage })));
const SettingsPage = lazy(() => import("./pages/settings").then((m) => ({ default: m.SettingsPage })));
const MethodologyPage = lazy(() => import("./pages/methodology").then((m) => ({ default: m.MethodologyPage })));

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} position="bottom-right" richColors closeButton />;
}

function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="This page does not exist."
      action={
        <Button asChild variant="primary">
          <Link to="/">Go to overview</Link>
        </Button>
      }
    />
  );
}

const page = (node: ReactNode) => <Suspense fallback={<PageSkeleton />}>{node}</Suspense>;

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={page(<OverviewPage />)} />
        <Route path="new" element={page(<NewBenchmarkPage />)} />
        <Route path="runs/:id" element={page(<RunPage />)} />
        <Route path="history" element={page(<HistoryPage />)} />
        <Route path="compare" element={page(<ComparePage />)} />
        <Route path="runtimes" element={page(<RuntimesPage />)} />
        <Route path="settings" element={page(<SettingsPage />)} />
        <Route path="methodology" element={page(<MethodologyPage />)} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
      <ThemedToaster />
    </ThemeProvider>
  );
}
