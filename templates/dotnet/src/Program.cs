using System.CommandLine;
using System.Reflection;
using Cli;
using Cli.Logging;
using Serilog;

var commandName = args.Length > 0 ? args[0] : "cli";
var (logger, logFilePath) = CliLoggerFactory.Create(commandName, "{{projectName}}");
Log.Logger = logger;

var root = new RootCommand("Interactive scaffolded CLI project");
CommandDiscovery.RegisterAll(root, Assembly.GetExecutingAssembly());

var config = new InvocationConfiguration { EnableDefaultExceptionHandler = false };

try
{
    var exitCode = root.Parse(args).Invoke(config);
    if (Environment.GetEnvironmentVariable("DEBUG") is not null)
    {
        Console.WriteLine($"Details: {logFilePath}");
    }
    return exitCode;
}
catch (CliUserException ex)
{
    Log.Error(ex, "Command failed");
    Console.Error.WriteLine($"\nError: {ex.Message}");
    Console.Error.WriteLine($"Details: {logFilePath}");
    return 1;
}
finally
{
    Log.CloseAndFlush();
}
