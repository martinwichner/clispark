from typer.testing import CliRunner

from cli.cli import app

runner = CliRunner()


def test_hello_runs_successfully():
    result = runner.invoke(app, ["hello", "--name", "Martin"])
    assert result.exit_code == 0
    assert "Hello, Martin!" in result.stdout
