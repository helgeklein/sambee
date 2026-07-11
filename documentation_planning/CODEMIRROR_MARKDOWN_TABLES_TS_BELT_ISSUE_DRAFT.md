# Issue Draft: Please remove the `@mobily/ts-belt` dependency

Thanks for your excellent work. Your project is exactly what I need to make Markdown editing in my Sambee project more user-friendly.

When I integrated `codemirror-markdown-tables` into our frontend, the published package broke in our app because of its dependency on `@mobily/ts-belt`.

The concrete problem is that `@mobily/ts-belt` publishes an ESM entry that uses directory imports like `./Function` instead of explicit file imports like `./Function/index.js`. In our Node/Vite/Vitest setup, that produces an error about unsupported directory imports in ESM.

I worked around that error by patching `@mobily/ts-belt`, but I'd very much prefer a stable root-cause fix. I evaluated raising an issue with `@mobily/ts-belt`, but then I noticed that it may effectively be abandoned ([source](https://github.com/mobily/ts-belt/issues/120)).

That's why I'm asking: Would you consider removing `@mobily/ts-belt` from `codemirror-markdown-tables`?

More detail:

You might have missed this issue because your repo seems to build and test from source, while our failure happens when consuming the published package as a dependency. In other words, your local Vite/Vitest workflow may not be exercising the same installed `dist` path that downstream users are hitting.

Our direct dependency is `codemirror-markdown-tables@1.0.0`, and the problematic transitive dependency is `@mobily/ts-belt@3.13.1`.

If helpful, I can also share the exact local patch I had to apply.
