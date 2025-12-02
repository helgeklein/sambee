## Principles

- Use defensive programming.
- Follow the DRY principle.
- Favor elegant solutions.
- Don't use hacks. Find the root cause and fix problems properly.
- All potential errors should be handled. The user should not see stack traces, but clear, concise log messages.

## AI behavior

- When asked to analyze or research, present your findings and ask if/how to implement them.

## Correctness

- **Lint:** Always run lint after making changes and fix any warnings or errors.

## Coding style

- **Comments:** add docstrings and comments for non-obvious code.
- Don't use magic strings or magic numbers. Use centrally defined constants, enums, or similar instead.
- Above each function definition, insert three comment lines with the function name, e.g.:
  ```
  #
  # function_name
  #
  def function_name()
  ```
- Add a blank line for readability after the docstring in a function head. Example:
  ```
  def function_name()
  """Function description"""
                                # <<<<------- empty line
                                # <<<<------- first line of code
  ```
## Git Commits

- Never commit your changes. That will be done manually.

## Documentation

- End-user docs reside in the directory `documentation`
- Developer docs reside in the directory `documentation_developers`