Describe 'Get-Hello' {
    It 'greets the given name' {
        Get-Hello -Name 'Pester' | Should -Be 'Hello, Pester!'
    }

    It 'defaults to World when no name is given' {
        Get-Hello | Should -Be 'Hello, World!'
    }
}
