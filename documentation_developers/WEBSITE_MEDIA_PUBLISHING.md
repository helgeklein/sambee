# Website Media Publishing

This document describes the website media workflow with strict parity to the
donor site's implemented behavior.

## Goals

- Source images are committed in the repository.
- Pre-generated WebP derivatives are committed in the repository.
- Both source and generated media are tracked with Git LFS.
- CI pulls media from Git LFS before building.
- CI publishes built media from `website/public` rather than generating missing
  derivatives during deployment.

## Required Tools

- `git-lfs` must be installed locally.
- ImageMagick's `magick` command must be available when generating derivatives.

After cloning the repository, run:

```bash
git lfs pull
```

If Git LFS objects are not present, website builds may succeed with broken image
references or fall back to originals instead of donor-style responsive WebPs.

## Source Of Truth

The source of truth for website media is the checked-in asset tree:

- `website/assets/images/` for source images and generated WebPs
- `website/static/files/` for downloadable files
- `website/resources/_gen/images/` for Hugo's cached processed image outputs

Generated WebPs live in a sibling `generated/` folder next to each source
image. Example:

```text
website/assets/images/home/companion-screenshot.png
website/assets/images/home/generated/companion-screenshot_372w.webp
website/assets/images/home/generated/companion-screenshot_500w.webp
```

## Authoring Workflow

When adding or changing a website image:

1. Add or update the source file under `website/assets/images/`.
2. Generate responsive WebP derivatives:

   ```bash
   cd website
   npm run images:generate
   ```

3. Review the generated files in the matching `generated/` directory.
4. Commit the source image and all generated WebP files together.

Do not rely on CI to create missing derivatives. Donor parity requires CI to use
what is already committed.

## Build And Publish Expectations

- Local development should pull LFS objects before serving the website.
- CI should restore and pull Git LFS objects before the website build.
- CI should sync built media from `website/public/images/` and
  `website/public/files/` to object storage.
- CI should deploy the HTML site separately from the media sync.

The repository workflow for this lives in `.github/workflows/website-deploy.yml`.
It mirrors the donor's actual implementation pattern:

- build on pull requests and pushes
- restore `.git/lfs` cache and run `git lfs pull`
- restore `website/resources/_gen` cache for faster Hugo rebuilds
- build the Hugo site and Pagefind index inside `website/`
- upload `website/public` as a short-lived artifact
- on deploy, sync `website/public/images/` and `website/public/files/` to R2
- deploy `website/public` to Cloudflare Pages

## Deployment Secrets

The website deployment workflow expects these GitHub Actions secrets:

- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_ENDPOINT`
- `R2_BUCKET_NAME`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_PAGES_PROJECT`

## CDN Configuration

`website/config/_default/params.toml` includes a donor-parity `[cdn]` section:

- `images_base_url`
- `files_base_url`

These values are configuration placeholders to keep the Sambee website aligned
with the donor setup. Like the donor implementation, the current templates still
emit stable `/images/...` and `/files/...` paths. The deploy workflow provides
the media sync to R2; switching template output to explicit CDN hostnames is a
separate concern and is not required for strict donor parity.

## Review Checklist

- New or changed source images are tracked by Git LFS.
- Matching generated WebPs exist and are tracked by Git LFS.
- No `generated/` directories are gitignored.
- Website image changes are committed together with their derivatives.
