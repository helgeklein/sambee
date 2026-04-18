## Principles

- Use defensive programming.
- Follow the DRY principle.
- Favor simple, robust, elegant solutions.
- Don't use hacks. Find the root cause and fix problems properly.

### Error handling and logging

- All potential errors, exceptions, and return values must be handled properly.
- Log messages should be specific to the situation and contain actionable info for the user.

## AI behavior

- When asked to analyze or research, present your findings. Then ask if/how to implement them.

## Correctness

- Always run lint and relevant tests after making changes and fix any warnings or errors.
- Run individual test with plain commands only.

## Coding style

- Add docstrings and comments for non-obvious code.
- Don't use magic strings or magic numbers. Use centrally defined constants, enums, or similar instead.

## Git Commits

- Never commit your changes. That will be done manually.

## Documentation

- End-user docs reside in the directory `documentation`
- Developer docs reside in the directory `documentation_developers`
- For dependency update and lockfile workflow details, consult `documentation_developers/DEVELOPMENT.md` before changing pinned or hashed dependencies.
