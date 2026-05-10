+++
title = "Media Publishing Workflow"
+++

The website media workflow is repository-driven. The source files and the generated derivatives both belong in the repo.

## Goals

- Source images are committed in the repository.
- Pre-generated WebP derivatives are committed in the repository.
- The committed social preview PNG is generated locally and committed in the repository.
- Source images and generated derivatives are tracked with Git LFS.
- Every raster source image has generated WebP derivatives.
- Local development and CI pull media from Git LFS before building.
- CI publishes built media from `website/public` rather than generating missing derivatives during deployment.

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
- `website/assets/images/` for source images and committed generated derivatives, including WebPs and the social preview PNG
- `website/static/files/` for downloadable files

Hugo's cached outputs under `website/resources/_gen/images/` are build artifacts, not source content and not committed media.

Generated derivatives live in a sibling `generated/` directory next to the source image.

Example:

```text
website/assets/images/home/companion-screenshot.png
website/assets/images/home/generated/companion-screenshot_372w.webp
website/assets/images/home/generated/companion-screenshot_500w.webp
website/assets/images/home/generated/sambee-screenshot_1200w.png
```

## Authoring Workflow

When you add or change a raster image:

1. Add or update the source file under `website/assets/images/`.
2. Start the website preview task or run `npm run dev`.
3. Let the local watcher regenerate missing derivatives automatically, or generate them manually.
4. Review the generated files in the matching `generated/` directory.
5. Commit the source image and the generated derivatives together.

The local watcher covers two cases:

- For ordinary raster images, it regenerates the matching WebP derivatives.
- For `website/assets/images/home/sambee-screenshot.png`, it also regenerates the committed social preview PNG at `website/assets/images/home/generated/sambee-screenshot_1200w.png`.

Manual batch generation:

```bash
cd website
npm run images:generate
```

Manual social preview generation:

```bash
cd website
npm run social:generate
```

Do not rely on CI to create missing derivatives. Missing generated media is a defect.

## Build and Publish Expectations

The website build and deployment flow is set up around this behavior:

- Local development pulls Git LFS objects before serving the site.
- The local dev workflow runs the image watcher during `npm run dev`.
- CI restores and pulls Git LFS objects before building the site.
- CI validates that raster source images have generated WebP derivatives.
- The shared head template fails the Hugo build if the committed social preview PNG is missing or is not `1200x630`.
- CI uploads `website/public` as a short-lived artifact after the build.
- The deploy job publishes `website/public` to Cloudflare Pages.

The project scripts that matter most here are:

- `npm run images:generate`
- `npm run images:validate`
- `npm run social:generate`
- `npm run build`

The workflow lives in `.github/workflows/website-deploy.yml`. The important steps include:

- restore `.git/lfs` cache and run `git lfs pull`
- restore `website/resources/_gen` cache for faster rebuilds
- validate generated WebP coverage
- build the Hugo site and Pagefind index inside `website/`
- upload `website/public` as a short-lived artifact
- deploy the built site from `website/public`

For the Cloudflare-side setup, GitHub Actions secrets, and deployment branch rules, see [Set Up Cloudflare Pages Publishing](../../setup-and-operations/set-up-cloudflare-pages-publishing/).
