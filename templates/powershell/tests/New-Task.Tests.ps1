Describe 'New-Task' {
    It 'creates a task with just a title' {
        New-Task -Title 'Buy milk' | Should -Be 'Created task: "Buy milk"'
    }

    It 'creates a task with an optional priority' {
        New-Task -Title 'Buy milk' -Priority 'High' | Should -Be 'Created task: "Buy milk" (priority: High)'
    }
}
