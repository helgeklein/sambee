# Move Sambee to a GitHub organization

Transfer only `helgeklein/sambee` now. Keep `helgeklein/sambee-companion` and its GitHub Pages feed at `release-feeds.sambee.net`; keep the separate Cloudflare Pages site at `sambee.net`. Do not rename the personal account or reuse its `sambee` repo name: old GitHub links need that redirect. GHCR image names do **not** redirect.

Run these from a maintainer machine with authenticated `gh`, Docker Buildx, `curl`, and `jq` (they are not all installed in the dev container). Set `ORG` once in the same shell:

```bash
ORG=your-new-org-name
gh auth status
```

## Before transfer

- [ ] Create the organization at `https://github.com/organizations/plan` with your personal account as owner.
- [ ] Confirm the old public image can be pulled without GHCR login:

```bash
docker buildx imagetools inspect ghcr.io/helgeklein/sambee:stable
```

- [ ] Let Docker, Companion, and website workflows finish; do not start another build or create a release tag until post-transfer checks pass.

## Transfer and check

- [ ] Transfer the repository (GitHub may ask for confirmation):

```bash
gh api -X POST repos/helgeklein/sambee/transfer -f new_owner="$ORG"
```

- [ ] Confirm the new repo and the old Git URL work; update your local remote:

```bash
gh repo view "$ORG/sambee" --json nameWithOwner
git ls-remote https://github.com/helgeklein/sambee.git HEAD
git remote set-url origin "https://github.com/$ORG/sambee.git"
```

- [ ] In the transferred repo's **Settings > Actions > General**, confirm Actions are enabled. If a workflow is blocked, check the org's **Settings > Actions > General** policy for allowed third-party actions. GitHub retains repo secrets, webhooks and deploy keys on transfer; only investigate a credential if its workflow fails. No org-level variables or self-hosted runners are used here.
- [ ] Deploy docs to the existing Cloudflare Pages project, check the run, and retest the old image from a shell without GHCR login:

```bash
gh workflow run website-deploy.yml -R "$ORG/sambee" --ref main
gh run list -R "$ORG/sambee" --workflow website-deploy.yml --limit 1
curl -fsSL -o /dev/null https://sambee.net/docs/
docker buildx imagetools inspect ghcr.io/helgeklein/sambee:stable
```

==========================
Status: done until here
==========================

## Before the next stable release

- [ ] With a new, committed `VERSION` on `main`, build an org-owned Docker candidate (publishes `test`, **not** stable). Confirm the run pushed staging images, then inspect `ghcr.io/$ORG/sambee` and `sambee-signatures` for the candidate digest and Cosign signature under the new org workflow identity. Staging packages may be cleaned up after the run.

```bash
VERSION=$(tr -d '[:space:]' < VERSION)
gh workflow run docker-image-preview-publish.yml -R "$ORG/sambee" --ref main
gh run list -R "$ORG/sambee" --workflow docker-image-preview-publish.yml --limit 1
docker buildx imagetools inspect "ghcr.io/$ORG/sambee:build-v$VERSION"
```

- [ ] If GHCR rejects a push, check the affected package's **Package settings > Manage Actions access** for the transferred repo. The workflow already requests `packages: write`.
- [ ] Make the new org image public in its GHCR package settings; from a shell without GHCR login, check `docker buildx imagetools inspect "ghcr.io/$ORG/sambee:build-v$VERSION"`. Leave the old personal image and tags available, but publish no new tags there.
- [ ] With that same fresh build version, test Companion publication to the **unchanged** personal release repo (the Linux selection prevents a no-op build):

```bash
gh workflow run build-companion.yml -R "$ORG/sambee" --ref main \
	-f build_version="$VERSION" -f build_linux_x64=true
gh run list -R "$ORG/sambee" --workflow build-companion.yml --limit 1
gh release view "companion-v$VERSION" -R helgeklein/sambee-companion
curl -fsSL https://release-feeds.sambee.net/feeds/companion/tauri/test/latest.json | jq .
```

The Companion workflow publishes the release and moves only `test`; verify its release asset URL in that feed. Keep the personal release repo, updater signing keys, and `release-feeds.sambee.net` unchanged.

- [ ] Publish the first stable release using the existing release flow. Then verify `docker buildx imagetools inspect "ghcr.io/$ORG/sambee:stable"` works without GHCR login. Tell Docker users to change `ghcr.io/helgeklein/sambee:stable` to `ghcr.io/$ORG/sambee:stable` in Compose, and update the example and installation docs. Old images remain pullable but will not receive new releases.

Moving the Companion release repo can wait.
