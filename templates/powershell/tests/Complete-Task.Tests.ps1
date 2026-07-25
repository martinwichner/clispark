Describe 'Complete-Task' {
    It 'marks a task as complete' {
        Complete-Task -Id 1 | Should -Be 'Completed task 1'
    }
}
