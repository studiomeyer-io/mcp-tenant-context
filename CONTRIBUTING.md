# Contributing

Thanks for considering a contribution. This is a small, focused library, so the
process is light.

## Development

```bash
npm ci          # install (lockfile-exact)
npm test        # run the vitest suite
npm run typecheck   # tsc --noEmit (strict)
npm run build   # emit dist/
```

Node 22+ is required (the library uses `AsyncLocalStorage`).

## Pull requests

- Keep the public API surface small and intentional. New exports need a clear
  use case — this library deliberately stays minimal.
- Every behaviour change needs a test. The whole value of the library is correct
  context propagation, so the suite is the contract.
- `npm test` and `npm run typecheck` must be green. CI also runs `publint` and
  `@arethetypeswrong/cli` against the packed tarball — keep `package.json`
  exports/types clean.
- Follow [Conventional Commits](https://www.conventionalcommits.org/) for commit
  messages (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Update [`CHANGELOG.md`](./CHANGELOG.md) under the `Unreleased` heading.

## Versioning

Strict [SemVer](https://semver.org/). No breaking change to the public API
without a major bump and a migration note in the changelog.

## Security

Do not open public issues for vulnerabilities — follow [SECURITY.md](./SECURITY.md).

## License

By contributing you agree that your contributions are licensed under the
project's [MIT License](./LICENSE).
