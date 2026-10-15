# Workflows, waiting to be switched on

`ci.yml` (typecheck, tests, the browser walk, and the shell's self-test on Linux) and `macos.yml`
(builds, signs and self-tests `Office.app`, then makes the dmg) belong in `.github/workflows/`. The
session that wrote them could not create files there (GitHub asks for the `workflow` permission),
so they wait here. To switch them on, from a clone with your own credentials:

```sh
git mv ci/workflows/ci.yml ci/workflows/macos.yml .github/workflows/ && git commit -m "Switch on CI" && git push
```

or on github.com: create `.github/workflows/ci.yml` and `.github/workflows/macos.yml` with these
files' contents. Then delete this folder.
