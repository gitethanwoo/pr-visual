# Agent Notes

- Bumping `package.json` version and pushing to `main` triggers the GitHub Actions workflow `.github/workflows/publish.yml`, which publishes to npm via Trusted Publisher. No manual `npm publish` is needed.
