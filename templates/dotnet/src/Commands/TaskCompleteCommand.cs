using System.CommandLine;

namespace Cli.Commands;

/// <summary>Nested subcommand ("task complete") with a required integer argument. Demonstrates CliUserException.</summary>
[CommandPath("task complete")]
public sealed class TaskCompleteCommand : ICliCommand
{
    public Command Build()
    {
        var idArgument = new Argument<int>("id")
        {
            Description = "Task ID to complete",
        };

        var command = new Command("complete", "Marks a task as complete");
        command.Arguments.Add(idArgument);
        command.SetAction(parseResult =>
        {
            var id = parseResult.GetValue(idArgument);
            if (id <= 0)
            {
                throw new CliUserException($"Task {id} does not exist.");
            }
            Console.WriteLine($"Completed task {id}");
        });

        return command;
    }
}
