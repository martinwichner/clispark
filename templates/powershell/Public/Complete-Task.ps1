function Complete-Task {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)]
        [int]$Id
    )
    process {
        Write-Output "Completed task $Id"
    }
}
