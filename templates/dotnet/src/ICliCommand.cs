using System.CommandLine;

namespace Cli;

public interface ICliCommand
{
    Command Build();
}
