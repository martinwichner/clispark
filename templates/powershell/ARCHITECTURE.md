# Architecture

This project is a PowerShell module (`.psd1`/`.psm1`), not a single script — cmdlets get proper
tab-completion, pipeline support, and discoverability via `Get-Command`.

## Auto-registration

Every `.ps1` file in `Public/` becomes an exported cmdlet automatically — no manual registration
step. The filename must match the function name inside it (e.g. `Get-Hello.ps1` defines
`function Get-Hello`).

## Auto-logging and error handling

`Module.psm1` wraps every `Public/` function with a **function-proxy-wrapper** at import time:
logging (`started`/`completed`/`failed`) and error handling are added automatically, using
PowerShell's own `System.Management.Automation.ProxyCommand` API — the same mechanism PowerShell's
own module-remoting proxies use, so pipeline input and all parameter attributes are preserved
exactly. Cmdlet authors never write their own try/catch or logging calls.

## Testing

[Pester](https://pester.dev/) — one `.Tests.ps1` file per cmdlet in `tests/`.

## Logging

[PSFramework](https://psframework.org/) — see `Logging/Initialize-Logging.ps1`.
