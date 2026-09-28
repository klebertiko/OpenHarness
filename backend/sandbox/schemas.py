from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')


class Read(StrictModel):
    name: Literal['read'] = 'read'
    path: str = Field(min_length=1)
    max_bytes: int = Field(default=262144, ge=1, le=262144)
    truncate: bool = True


class Exec(StrictModel):
    name: Literal['exec'] = 'exec'
    argv: list[str] = Field(min_length=1)
    cwd: str = '.'
    timeout_s: int = Field(default=60, ge=1, le=600)

    @field_validator('argv')
    @classmethod
    def executable_present(cls, value):
        if not value[0]:
            raise ValueError('executable is required')
        return value


class Discover(StrictModel):
    name: Literal['discover'] = 'discover'


class ToolsRequest(StrictModel):
    enabled: bool = False
    preset: Annotated[Read | Exec | Discover, Field(discriminator='name')] | None = None
    summarize: bool = True


def validate_call(name: str, args: dict):
    schema = {'read': Read, 'exec': Exec, 'discover': Discover}.get(name)
    if schema is None:
        raise ValueError('unknown_tool')
    return schema.model_validate({**args, 'name': name})


TOOL_SCHEMAS = [
    {'type': 'function', 'function': {'name': 'read_file', 'description': 'Read a UTF-8 text file inside the workspace.',
        'parameters': {'type': 'object', 'properties': {'path': {'type': 'string'}}, 'required': ['path']}}},
    {'type': 'function', 'function': {'name': 'list_workspace', 'description': 'List skills, commands and npm scripts in the workspace.',
        'parameters': {'type': 'object', 'properties': {}}}},
    {'type': 'function', 'function': {'name': 'run_command', 'description': 'Run a program locally. No shell: argv only. Every command requires user approval.',
        'parameters': {'type': 'object', 'properties': {'argv': {'type': 'array', 'items': {'type': 'string'}},
            'cwd': {'type': 'string'}, 'timeout_s': {'type': 'integer'}}, 'required': ['argv']}}},
]
