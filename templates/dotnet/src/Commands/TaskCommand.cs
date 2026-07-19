using System.CommandLine;

namespace Cli.Commands;

/// <summary>Optional argument constrained to a fixed set of allowed values.</summary>
[CommandPath("task")]
public sealed class TaskCommand : ICliCommand
{
    public Command Build()
    {
        var statusArgument = new Argument<string?>("status")
        {
            Description = "Filter by status",
            Arity = ArgumentArity.ZeroOrOne,
        };
        statusArgument.AcceptOnlyFromAmong("open", "done");

        var command = new Command("task", "Shows tasks, optionally filtered by status");
        command.Arguments.Add(statusArgument);
        command.SetAction(parseResult =>
        {
            var status = parseResult.GetValue(statusArgument);
            Console.WriteLine(status is null ? "Showing all tasks" : $"Showing {status} tasks");
        });

        return command;
    }
}
