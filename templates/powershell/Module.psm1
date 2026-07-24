# Module.psm1 — loads every cmdlet in Public/ and wraps it with automatic logging and
# error handling. Cmdlet authors never write their own try/catch or logging calls.

. (Join-Path $PSScriptRoot 'Logging' 'Initialize-Logging.ps1')

$publicFiles = Get-ChildItem -Path (Join-Path $PSScriptRoot 'Public') -Filter '*.ps1'
$publicFuncNames = $publicFiles.BaseName

foreach ($file in $publicFiles) {
    . $file.FullName
    $funcName = $file.BaseName

    # Rename the real implementation FIRST, then build the proxy metadata against the RENAMED
    # command — the generated begin-block re-resolves the wrapped command by name at call time,
    # so building metadata from the original name before renaming would make the wrapper recurse
    # into itself once installed under that same name (verified for real during the design spec).
    $renamedName = "__orig_$funcName"
    Rename-Item "Function:\$funcName" $renamedName
    $renamedCmd = Get-Command $renamedName -CommandType Function
    $metadata = [System.Management.Automation.CommandMetadata]::new($renamedCmd)

    $paramBlock = [System.Management.Automation.ProxyCommand]::GetParamBlock($metadata)
    $beginBlock = [System.Management.Automation.ProxyCommand]::GetBegin($metadata)
    $processBlock = [System.Management.Automation.ProxyCommand]::GetProcess($metadata)
    $endBlock = [System.Management.Automation.ProxyCommand]::GetEnd($metadata)
    $cmdletBinding = [System.Management.Automation.ProxyCommand]::GetCmdletBindingAttribute($metadata)

    $wrapperDef = @"
function $funcName {
$cmdletBinding
param(
$paramBlock
)
begin {
    Write-PSFMessage -Level Verbose -Message "started: $funcName"
    `$__sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
$beginBlock
    } catch {
        Write-PSFMessage -Level Error -Message "failed: $funcName" -ErrorRecord `$_
        throw
    }
}
process {
    try {
$processBlock
    } catch {
        Write-PSFMessage -Level Error -Message "failed: $funcName" -ErrorRecord `$_
        throw
    }
}
end {
    try {
$endBlock
        Write-PSFMessage -Level Verbose -Message "completed: $funcName (`$(`$__sw.ElapsedMilliseconds)ms)"
    } catch {
        Write-PSFMessage -Level Error -Message "failed: $funcName" -ErrorRecord `$_
        throw
    }
}
}
"@

    Invoke-Expression $wrapperDef
}

# Export only the real Public/ function names — never `-Function *`, which would also export
# the renamed __orig_* internals and trigger PowerShell's "unapproved verb" warning on import
# (verified for real during the design spec).
Export-ModuleMember -Function $publicFuncNames
