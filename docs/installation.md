# Installing the runtimes

BunBench needs **Bun** for the application itself. **Node.js** is optional: without it, Node.js benchmarks are marked *unavailable* and everything else works.

## Bun (required, ≥ 1.2)

| Platform | Command |
|---|---|
| Windows (PowerShell) | `powershell -c "irm bun.sh/install.ps1 \| iex"` |
| macOS / Linux | `curl -fsSL https://bun.sh/install \| bash` |

Open a **new** terminal afterwards so `bun` is on `PATH`, then check it with `bun --version`.

If `bun` is installed but not found, add its directory to `PATH`:
- Windows: `%USERPROFILE%\.bun\bin`
- macOS/Linux: `~/.bun/bin`

Docs: https://bun.sh/docs/installation

## Node.js (optional, ≥ 22.18)

The Node runner executes TypeScript using Node's built-in type stripping. This is unflagged from Node 22.18 (and 23.6). Node 24 LTS is recommended.

| Platform | Options |
|---|---|
| Windows | Installer from https://nodejs.org, or `winget install OpenJS.NodeJS.LTS`, or nvm-windows / fnm / volta |
| macOS | Installer, `brew install node@24`, or nvm / fnm / volta |
| Linux | Distribution packages are often outdated. Use NodeSource, nvm, fnm or volta |

Check with `node --version`.

To benchmark a specific Node (or Bun) build, set an absolute path in `.env` and restart the API:

```
BUNBENCH_NODE_PATH=C:\tools\node-v24.22.1\node.exe
```

The **Runtimes** page and `GET /api/runtimes?refresh=1` show what BunBench detected and why a runtime is unavailable.
