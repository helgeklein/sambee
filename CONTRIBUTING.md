# Contributing to Sambee

Thank you for helping improve Sambee. This guide explains how to propose, implement, test, and submit changes to the project.

## Code of Conduct

All participation in this project is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Contribution Workflow

### Planning

Please start with a planning step before working on code and submitting pull requests:

- Create an issue in which you describe your proposed change in detail:
  - Purpose and use case
  - Architecture (how will it work?)
  - Implementation (what will the code look like?)
- A maintainer will then look at your proposal and get back to you and either:
  - Approve
  - Request changes
  - Reject
- Once the proposal has been approved, please continue with the next step (pull request).

### Pull Request

Open a pull request against `main` after the proposal has been approved. In the PR:

- Describe the user or maintainer-facing result, not only the code change.
- Call out documentation, migration, compatibility, security, or release implications.

Maintainers may request changes, approve the pull request, or decline it when it does not fit the project's direction or quality requirements.

## Development Environment

The supported development environment is the repository's Dev Container. Open the repository in Visual Studio Code and use **Dev Containers: Reopen in Container**. The container installs the required toolchains and starts the backend and frontend development servers when the workspace opens.

See the [developer guide](https://sambee.net/docs/developer-guide/) for details.

## Making a Change

1. Fork the repository and create a focused branch from `main`.
2. Make the smallest change that resolves the agreed problem. Keep unrelated refactors and generated artifacts out of the pull request.
3. Add or update tests for changed behavior. Include regression coverage when fixing a defect.
4. Update the relevant documentation under `website/content/docs/` when the user, administrator, developer, API, configuration, or release behavior changes. Preserve the documentation version-inheritance model.

## Testing

Run the full local test suite before opening a cross-cutting pull request:

```bash
./scripts/lint
./scripts/test
```

Formatting and linting are part of the project contract: use Ruff for Python, Biome for TypeScript and frontend code, and `cargo fmt` for Rust. Do not silence test failures, type errors, lint warnings, or security checks without discussing the reason in the pull request.

## License

By contributing to this repository, you agree that your contributions are licensed under the project's [MIT License](LICENSE).
