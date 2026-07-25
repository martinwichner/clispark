function Get-Task {
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [string]$Filter,

        [switch]$Done
    )
    process {
        $base = if ($Filter) { "Listing tasks matching `"$Filter`"" } else { 'Listing all tasks' }
        if ($Done) {
            Write-Output "$base (completed only: true)"
        } else {
            Write-Output $base
        }
    }
}
