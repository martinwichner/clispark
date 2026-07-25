function New-Task {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)]
        [string]$Title,

        [ValidateSet('Low', 'Medium', 'High')]
        [string]$Priority
    )
    process {
        if ($Priority) {
            Write-Output "Created task: `"$Title`" (priority: $Priority)"
        } else {
            Write-Output "Created task: `"$Title`""
        }
    }
}
