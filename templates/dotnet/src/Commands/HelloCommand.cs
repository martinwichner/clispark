using System.CommandLine;
using Serilog;

namespace Cli.Commands;

/// <summary>Required string argument.</summary>
[CommandPath("hello")]
public sealed class HelloCommand : ICliCommand
{
    public Command Build()
    {
        var nameArgument = new Argument<string>("name")
        {
            Description = "Who to greet",
        };

        var command = new Command("hello", "Says hello to someone");
        command.Arguments.Add(nameArgument);
        command.SetAction(parseResult =>
        {
            var name = parseResult.GetValue(nameArgument);
            Log.Information("Greeting {Name}", name);
            Console.WriteLine($"Hello, {name}!");
        });

        return command;
    }
}
