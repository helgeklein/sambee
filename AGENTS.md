## Principles

- Use defensive programming.
- Follow the DRY principle.
- Favor simply, robust, elegant solutions.
- Don't use hacks. Find the root cause and fix problems properly.

### Error handling and logging

- All potential errors should be handled. The user should not see stack traces, but clear, concise log messages.
- Log messages should be specific to the situation and contain actionable info for the user.

## AI behavior

- When asked to analyze or research, present your findings. Then ask if/how to implement them.

## Correctness

- Always run lint after making changes and fix any warnings or errors.

## Coding style

- Add docstrings and comments for non-obvious code.
- Don't use magic strings or magic numbers. Use centrally defined constants, enums, or similar instead.

## Git Commits

- Never commit your changes. That will be done manually.

## Documentation

- End-user docs reside in the directory `documentation`
- Developer docs reside in the directory `documentation_developers`