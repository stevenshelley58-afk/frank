# Third-party notices — frank-codegraph

## Graphify

Frank bundles and invokes Graphify from
`https://github.com/Graphify-Labs/graphify` at commit
`50556baaea803e191947fdfcc2e0c22e2d4eb74d` (package `graphifyy` version
`0.9.39`). Graphify is licensed under the Apache License, Version 2.0.

Copyright 2026 Safi Shamsi and the Graphify contributors.

Upstream NOTICE:

> Portions of this software were contributed under the MIT License prior to
> relicensing and remain available under those terms. The original MIT license
> text is retained in LICENSE-MIT.

The upstream Apache license, NOTICE and historical MIT license are preserved in the
installed distribution. The source and notices are available at the pinned
upstream commit above.

## CPython and runtime ELF closure

The scratch image contains the minimum CPython 3.14.6 standard-library and ELF
closure assembled from the digest-pinned official `python:3.14.6-alpine3.24`
builder. CPython is distributed under the Python Software Foundation License
Version 2; its complete license history is retained at
`/usr/local/lib/python3.14/LICENSE.txt` in the image. Available system-library
license files from the builder are preserved under `/usr/share/licenses`.
The final SPDX SBOM and build provenance identify the exact published runtime
contents and immutable builder digest.
