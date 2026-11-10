# Repository Guidelines

## Project Structure

This workspace has no project files or Git metadata. Keep this guide at the project root when the repository is added. Update this section with the actual paths for source code, tests, and assets once those directories exist.

## Build, Test, and Development

When adding the project, document the commands contributors can run from the root to install dependencies, start the project locally, build it, and run checks. Identify any required tools, versions, and environment variables. Use the commands defined in the project's scripts or build configuration so local instructions match what CI runs.

## Coding Style and Testing

Follow the formatting and naming conventions in adjacent code. If the project adds a formatter or linter, commit its configuration and document the check command here. Use the project's test framework and naming conventions once established. For behavior changes, cover the affected path and any regression the change addresses. Run the relevant tests before requesting review.

## Commits and Pull Requests

Use short, imperative commit subjects such as `Document local setup`. Keep each commit focused on one change. In a pull request, describe the purpose, summarize the change, and report which checks you ran. Link the related issue when there is one and include screenshots for visible UI changes. Once Git history and a pull request template are available, update these instructions to reflect the project's conventions.
