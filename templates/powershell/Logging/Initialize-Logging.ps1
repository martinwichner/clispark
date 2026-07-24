# Logging/Initialize-Logging.ps1 — PSFramework setup, loaded by Module.psm1 before any cmdlet
# is wrapped. Mirrors the Node/.NET templates' logging principles: redaction, retention, DEBUG
# streaming, a visible log path on both success and failure.

Import-Module PSFramework -ErrorAction Stop

$logDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'clispark-generated' 'Logs'
if (-not (Test-Path $logDirectory)) {
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
}

Set-PSFLoggingProvider -Name 'logfile' -InstanceName 'default' -FilePath (Join-Path $logDirectory 'log-%date%.csv') -Enabled $true

if ($env:DEBUG) {
    Set-PSFLoggingProvider -Name 'console' -InstanceName 'default' -Enabled $true
}

# Retention: remove log files older than 14 days, best-effort (matches the Node/.NET templates'
# LOG_RETENTION_DAYS convention — same default, same "never block the command on a sweep failure").
try {
    $cutoff = (Get-Date).AddDays(-14)
    Get-ChildItem -Path $logDirectory -Filter 'log-*.csv' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt $cutoff } |
        Remove-Item -ErrorAction SilentlyContinue
} catch {
    # Best-effort — a failed sweep must never block the command itself.
}
