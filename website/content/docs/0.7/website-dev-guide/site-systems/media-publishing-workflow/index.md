+++
title = "Media Publishing Workflow"
+++

The website media workflow is repository-driven. The source files and the generated derivatives both belong in the repo.

## Goals

- source images are committed in the repository
- pre-generated WebP derivatives are committed in the repository
- source images and generated derivatives are tracked with Git LFS
- every raster source image has generated WebP derivatives
- local development and CI pull media from Git LFS before building
- CI publishes built media from `website/public` rather than generating missing derivatives during deployment

## Required Tools

You need:

- `git-lfs`
- ImageMagick's `magick` command when generating derivatives locally

After cloning, pull LFS objects before you work on the site:

```bash
git lfs pull
```

If the LFS objects are missing, a site build may appear to work while still producing broken image references or missing derivatives.

## Source of Truth

The source of truth for website media is the checked-in asset tree:

- `website/assets/images/` for source images and generated WebPs
- `website/static/files/` for downloadable files
- `website/resources/_gen/images/` for Hugo's cached processed image outputs

Generated WebPs live in a sibling `generated/` directory next to the source image.

Example:

```text
website/assets/images/home/companion-screenshot.png
website/assets/images/home/generated/companion-screenshot_372w.webp
website/assets/images/home/generated/companion-screenshot_500w.webp
```

## Authoring Workflow

When you add or change a raster image:

1. add or update the source file under `website/assets/images/`
2. start the website preview task or run `npm run dev`
3. let the local WebP watcher regenerate missing derivatives automatically, or generate them manually
4. review the generated files in the matching `generated/` directory
5. commit the source image and the generated WebPs together

Manual batch generation:

```bash
cd website
npm run images:generate
```

Do not rely on CI to create missing derivatives. Missing generated WebPs are a defect.

## Build and Publish Expectations

The website build and deployment flow expects this behavior:

- local development pulls Git LFS objects before serving the site
- the local dev workflow runs the WebP watcher during `npm run dev`
- CI restores and pulls Git LFS objects before building the site
- CI validates that raster source images have generated WebP derivatives
- deployment syncs built media from `website/public/images/` and `website/public/files/`
- HTML deployment happens separately from the media sync

The project scripts that matter most here are:

- `npm run images:generate`
- `npm run images:validate`
- `npm run build`

The deployment workflow lives in `.github/workflows/website-deploy.yml`. The important steps are:

- restore `.git/lfs` cache and run `git lfs pull`
- restore `website/resources/_gen` cache for faster rebuilds
- validate generated WebP coverage
- build the Hugo site and Pagefind index inside `website/`
- upload `website/public` as a short-lived artifact
- sync `website/public/images/` and `website/public/files/` to object storage during deploy
- deploy the built site from `website/public`

## Deployment Secrets

The website deployment workflow expects these GitHub Actions secrets:

- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_ENDPOINT`
- `R2_BUCKET_NAME`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_PAGES_PROJECT`

## CDN and Output Paths

The site configuration includes CDN-related placeholders in `website/config/_default/params.toml`, but the current templates still emit stable `/images/...` and `/files/...` paths.

That means day-to-day media work should focus on preserving the repository asset tree and the generated derivative coverage, not on inventing alternate output paths.

`website/config/_default/params.toml` includes a `[cdn]` section with:

- `images_base_url`
- `files_base_url`

Those values are configuration placeholders. The current templates still emit stable site-relative paths, so switching template output to explicit CDN hostnames is a separate concern from the normal media publishing workflow.

## Review Checklist

- new or changed source images are tracked by Git LFS
- matching generated WebPs exist and are tracked by Git LFS
- every raster source image has at least one matching generated WebP
- no `generated/` directories are ignored accidentally
- source images and derivatives are committed together
