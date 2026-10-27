# Contributing

Contributions, bug reports, and platform testing reports are welcome. Please distinguish behavior you reproduced from behavior you expect to work.

## Platform status

Windows with PowerShell is the currently tested setup. Linux and macOS support has not yet been validated. Reports from other platforms are useful even when they only identify a blocker or a reproducible failure.

## Bug reports and proposals

- For a bug, include the operating system and version, Node.js version, relevant OpenClaw/Gateway setup, exact steps to reproduce, expected behavior, and actual behavior.
- Include only the relevant, redacted logs. Do not attach API keys, tunnel credentials, local configuration files, private page contents, or unredacted monitor exports.
- For substantial changes or new public tools, open an issue first to discuss the intended behavior and scope.

## Development checks

On the currently tested Windows/PowerShell setup, run these from the repository root:

```powershell
npm run check
npm run test:unit
```

For an integration smoke test, use a locally configured and running bridge and Gateway:

```powershell
npm test -- -BaseUrl http://127.0.0.1:19002
```

The smoke test depends on local runtime configuration. The current check scripts are written for Windows/PowerShell, and other operating systems have not been validated yet. In a pull request, state your platform, which checks you ran, and whether integration testing was possible. Do not describe unrun tests as passing.

## Pull requests

- Keep each change focused and explain the problem it solves.
- Update tests and user-facing documentation when behavior, tool schemas, setup, or platform requirements change.
- Preserve OpenClaw's native permission and approval boundaries. Do not claim that a tool or platform is supported without verification.
- Never commit secrets, generated configuration, local state, credentials, or logs containing private data.
