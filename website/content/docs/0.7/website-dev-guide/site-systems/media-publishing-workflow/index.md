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

The website build and deployment flow is set up around this behavior:

- local development pulls Git LFS objects before serving the site
- the local dev workflow runs the WebP watcher during `npm run dev`
- CI restores and pulls Git LFS objects before building the site
- CI validates that raster source images have generated WebP derivatives
- CI uploads `website/public` as a short-lived artifact after the build
- the deploy job publishes `website/public` to Cloudflare Pages

The project scripts that matter most here are:

- `npm run images:generate`
- `npm run images:validate`
- `npm run build`

The workflow lives in `.github/workflows/website-deploy.yml`. The important steps include:

- restore `.git/lfs` cache and run `git lfs pull`
- restore `website/resources/_gen` cache for faster rebuilds
- validate generated WebP coverage
- build the Hugo site and Pagefind index inside `website/`
- upload `website/public` as a short-lived artifact
- deploy the built site from `website/public`

For the Cloudflare-side setup, GitHub Actions secrets, and deployment branch rules, see [Set Up Cloudflare Pages Publishing](../../setup-and-operations/set-up-cloudflare-pages-publishing/).
