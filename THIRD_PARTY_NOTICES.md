# Third-party notices

Original application code is under 0BSD. Third-party dependencies retain their own licenses; the 0BSD grant does not replace them.

The interface uses Inter and IBM Plex Mono under the SIL Open Font License 1.1. The installed OPAQUE package, hash-wasm, React, Lucide, Temporal, and other dependencies retain their supplied licenses and copyright notices. Password dictionary dataset notices and hash-wasm's embedded implementation notices are included.

[The distributed notices](public/THIRD_PARTY_NOTICES.txt) contain 56 installed packages; 83 notice sections; 22 hash-wasm source headers. They cover the installed runtime and development dependency graph on darwin/arm64, with every package version checked against the lockfile. Uninstalled optional platform packages and unreachable old package-store entries are excluded; development packages are not necessarily shipped in the browser.

Regenerate offline after a frozen-lockfile installation with `node scripts/third-party-notices.mjs`; verify the same installation with `node scripts/third-party-notices.mjs --check`. The script reads supplied legal files, complete README license sections for pg-types/pgpass, and hash-wasm source headers. Native esbuild/rolldown packages without their own notice use the same-version parent package's notices after checking the repository and declared license. Missing or unrecognized license sources cause generation to fail. No package scripts or network requests are run. This inventory is not an independent license audit of embedded upstream components.

Lockfile SHA-256: `6ab4ce5746d4959fdec5a4ab1c709bd8751cbfe8f1ee22d6b8bc0457f00f52a5`.

External medical documents are linked as references; their copyrights and trademarks remain with their owners. This project does not grant rights to those external materials.
