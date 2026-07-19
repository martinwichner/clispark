using System.CommandLine;
using Cli;
using Cli.Commands;

namespace Cli.Tests;

public class TaskCompleteCommandTests
{
    // Mirrors Program.cs: the default InvocationConfiguration silently swallows
    // exceptions thrown from a command's action, so tests exercising that
    // behavior must disable it the same way production wiring does.
    private static readonly InvocationConfiguration NonSwallowingConfig = new() { EnableDefaultExceptionHandler = false };

    [Fact]
    public void ThrowsCliUserExceptionForNonPositiveId()
    {
        var command = new TaskCompleteCommand().Build();
        var parseResult = command.Parse(["-1"]);

        var ex = Assert.Throws<CliUserException>(() => parseResult.Invoke(NonSwallowingConfig));
        Assert.Equal("Task -1 does not exist.", ex.Message);
    }

    [Fact]
    public void SucceedsForPositiveId()
    {
        var command = new TaskCompleteCommand().Build();
        var parseResult = command.Parse(["5"]);

        var exitCode = parseResult.Invoke(NonSwallowingConfig);

        Assert.Equal(0, exitCode);
    }
}
