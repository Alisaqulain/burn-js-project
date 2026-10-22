import * as Dialog from "@radix-ui/react-dialog";
import { BookOpen, Cpu, FlaskConical, GitCompareArrows, History, LayoutDashboard, Menu, Moon, Settings, Sun, X } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/new", label: "New benchmark", icon: FlaskConical, end: false },
  { to: "/history", label: "History", icon: History, end: false },
  { to: "/compare", label: "Compare", icon: GitCompareArrows, end: false },
  { to: "/runtimes", label: "Runtimes", icon: Cpu, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
  { to: "/methodology", label: "Methodology", icon: BookOpen, end: false },
] as const;

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors [&_svg]:size-4",
              isActive ? "bg-surface-2 font-medium text-fg" : "text-muted hover:bg-surface-2/60 hover:text-fg",
            )
          }
        >
          <Icon aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2 px-2.5">
      <svg aria-hidden viewBox="0 0 32 32" className="size-6">
        <rect width="32" height="32" rx="7" fill="var(--surface-2)" />
        <rect x="7" y="17" width="4" height="8" rx="1" fill="var(--series-bun)" />
        <rect x="14" y="11" width="4" height="14" rx="1" fill="var(--series-node)" />
        <rect x="21" y="7" width="4" height="18" rx="1" fill="var(--fg)" />
      </svg>
      <span className="text-sm font-semibold tracking-tight text-fg">BunBench</span>
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title="Toggle theme">
      {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}

export function AppShell() {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-border bg-surface px-3 py-4 lg:flex">
        <Brand />
        <div className="mt-6 flex-1">
          <NavItems />
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="px-2.5 text-xs text-subtle">Local · v0.1.0</span>
          <ThemeToggle />
        </div>
      </aside>

      {/* Mobile top bar + drawer */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-surface/95 px-4 py-2 backdrop-blur lg:hidden">
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open navigation">
              <Menu aria-hidden />
            </Button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
            <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-surface px-3 py-4">
              <div className="flex items-center justify-between">
                <Brand />
                <Dialog.Close asChild>
                  <Button variant="ghost" size="icon" aria-label="Close navigation">
                    <X aria-hidden />
                  </Button>
                </Dialog.Close>
              </div>
              <Dialog.Title className="sr-only">Navigation</Dialog.Title>
              <Dialog.Description className="sr-only">BunBench sections</Dialog.Description>
              <div className="mt-6">
                <NavItems onNavigate={() => setOpen(false)} />
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
        <Brand />
        <ThemeToggle />
      </header>

      <main id="main" className="min-w-0 overflow-x-clip px-4 py-6 sm:px-6 lg:ml-56 lg:px-8">
        <div className="mx-auto max-w-7xl min-w-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
