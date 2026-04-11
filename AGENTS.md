# Agent Instructions

## Publishing

When bumping the version in `package.json`, always publish a new version to npm:

```bash
npm publish --access public
```

This ensures consumers get the latest changes when they update. The package is published to npm as `@platanus/arcade-dev-ui-26` with public access.
