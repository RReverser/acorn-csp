acorn-csp
=========

Builder for Acorn that precompiles predicates in order to satisfy Content Security Policy (CSP).

This workaround addresses [acorn#90](https://github.com/marijnh/acorn/issues/90) and [acorn#123](https://github.com/marijnh/acorn/issues/123) issues.

For generating CSP-safe version, execute following command:

```bash
acorn-csp <destination filename> [path to acorn]
```

And use generated file instead of original Acorn's `acorn.js`.

When path to acorn is not specified, it's assumed to be available as `require('acorn')` from current directory.
