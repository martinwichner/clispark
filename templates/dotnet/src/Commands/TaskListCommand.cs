using System.CommandLine;

namespace Cli.Commands;

/// <summary>Nested subcommand ("task list") with two optional arguments: string + boolean.</summary>
[CommandPath("task list")]
public sealed class TaskListCommand : ICliCommand
{
    public Command Build()
    {
        var labelArgument = new Argument<string?>("label")
        {
            Description = "Filter by label",
            Arity = ArgumentArity.ZeroOrOne,
        };
        var allArgument = new Argument<bool?>("all")
        {
            Description = "Include completed tasks",
            Arity = ArgumentArity.ZeroOrOne,
        };

        var command = new Command("list", "Lists tasks");
        command.Arguments.Add(labelArgument);
        command.Arguments.Add(allArgument);
        command.SetAction(parseResult =>
        {
            var label = parseResult.GetValue(labelArgument);
            var all = parseResult.GetValue(allArgument) ?? false;
            Console.WriteLine($"Listing tasks (label={label ?? "any"}, all={all})");
        });

        return command;
    }
}
