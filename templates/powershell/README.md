# {{projectName}}

A PowerShell module scaffolded by [clispark](https://www.npmjs.com/package/clispark).

## Usage

```powershell
Import-Module ./Module.psd1
Get-Hello -Name 'World'
```

## Adding a new cmdlet

Run `clispark add` from this directory, or drop a new `.ps1` file into `Public/` following the
existing `Get-Hello.ps1` pattern — every function found there is automatically wrapped with
logging and error handling on module import, no manual try/catch needed.

## Testing

```powershell
Invoke-Pester ./tests
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md).
