function Get-Hello {
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [string]$Name = 'World'
    )
    process {
        Write-Output "Hello, $Name!"
    }
}
