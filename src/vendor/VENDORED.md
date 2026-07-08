# Vendored code

Everything in this directory is copied from
[covallaby/covallaby](https://github.com/covallaby/covallaby)
(`packages/core` and `packages/parsers`) with import specifiers rewritten,
because those packages are not on npm yet.

**Do not edit these files here.** Fix upstream, then re-vendor.
The moment `@covallaby/core` and `@covallaby/parsers` publish, this directory
is deleted in favor of real dependencies.
