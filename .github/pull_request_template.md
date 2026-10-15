### What this changes

### Why

<!-- Link the issue if there is one: Closes #123 -->

### How you checked it

<!-- What you clicked through, on which device. Screenshots welcome for anything you can see. -->

### Checklist

- [ ] `npm test` passes in `frontend/` (and in `api/` or `mcp/` if you touched them)
- [ ] New UI strings are in every locale pack (`cd frontend && node scripts/check-locales.mjs`)
- [ ] Training logic (what you lift next, how a session is read back) has a unit test beside it
- [ ] If you changed a rule that exists in both `frontend/src/lib` and `api/`, both sides changed
      ([which ones](https://github.com/DuarteSantos8/openGym/blob/main/docs/ARCHITECTURE.md#code-that-exists-twice-on-purpose))
- [ ] No new dependency, or the description says why it can't be avoided
- [ ] Nothing added to `catalogue/media/`, and CHANGELOG.md left alone (release notes are written
      at release time)

<!-- First pull request? The CLA check asks you to sign once with a comment (see CLA.md).
     Its workflows wait for a maintainer to start them, so "no checks yet" is normal. -->
