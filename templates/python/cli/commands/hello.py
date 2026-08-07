import typer

from cli.base_command import BaseCommand

app = typer.Typer()


class HelloCommand(BaseCommand):
    command_name = "hello"

    def run(self, name: str = "world") -> None:
        typer.echo(f"Hello, {name}!")


@app.callback(invoke_without_command=True)
def hello(name: str = typer.Option("world", "--name")) -> None:
    HelloCommand()(name=name)
