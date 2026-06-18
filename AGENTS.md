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
- Whenever changing code, verify if the related documentation needs to be updated, too.

## Correctness

- Always run lint and relevant tests after making changes and fix any warnings or errors.

## Coding style

- Add docstrings and comments for non-obvious code.
- Don't use magic strings or magic numbers. Use centrally defined constants, enums, or similar instead.

## Git Commits

- Never commit your changes. That will be done manually.

## Documentation

- All end-user, admin, developer, and website docs live in `website/content/docs/`.
- For all docs changes, follow the `docs-update` skill.

## Dependencies

- Before changing pinned or hashed dependencies or lockfiles, consult `website/content/docs/<VERSION>/developer-guide/release-and-versioning/dependency-and-release-workflow/index.md`.
