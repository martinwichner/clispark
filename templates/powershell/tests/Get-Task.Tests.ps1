Describe 'Get-Task' {
    It 'lists all tasks by default' {
        Get-Task | Should -Be 'Listing all tasks'
    }

    It 'lists tasks matching a filter' {
        Get-Task -Filter 'groceries' | Should -Be 'Listing tasks matching "groceries"'
    }

    It 'lists tasks matching a filter, showing only completed ones' {
        Get-Task -Filter 'groceries' -Done | Should -Be 'Listing tasks matching "groceries" (completed only: true)'
    }
}
