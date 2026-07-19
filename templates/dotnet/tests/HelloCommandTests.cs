using Cli.Commands;

namespace Cli.Tests;

public class HelloCommandTests
{
    [Fact]
    public void SucceedsWithARequiredNameArgument()
    {
        var command = new HelloCommand().Build();
        var parseResult = command.Parse(["World"]);

        var exitCode = parseResult.Invoke();

        Assert.Equal(0, exitCode);
    }

    [Fact]
    public void FailsWhenNameArgumentIsMissing()
    {
        var command = new HelloCommand().Build();
        var parseResult = command.Parse([]);

        var exitCode = parseResult.Invoke();

        Assert.NotEqual(0, exitCode);
    }
}
