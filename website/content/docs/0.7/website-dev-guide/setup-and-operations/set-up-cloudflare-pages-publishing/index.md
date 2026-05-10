+++
title = "Set Up Cloudflare Pages Publishing"
+++

Use this page to set up and maintain the website deployment workflow that publishes built website assets to Cloudflare Pages.

## Overview

The repository uses a split deployment model:

- Hugo builds the site into `website/public/`.
- Built assets are published from there to Cloudflare Pages.
- Source images and generated WebP derivatives remain in Git LFS.

The workflow builds on pull requests and pushes to `main`. The deploy job runs only on `main`.

## Prepare Cloudflare

Complete these Cloudflare steps first, then add the collected values to GitHub in the next section.

1. Create a Cloudflare Pages project to receive the built HTML from `website/public/`:
   - Go to **Workers & Pages** > **Create application**
   - Select **Looking to deploy Pages? Get started** > **Drag and drop your files - Get started**
   - Project name: `sambee-net` (to be stored in `CLOUDFLARE_PAGES_PROJECT`)
   - Select **Create project**
1. Go to the Pages project properties and set up a custom domain.
1. In **My Profile** > **API Tokens**, create a separate Cloudflare API token for the Pages deployment step:
   - Name: `GitHub Actions - deploy Pages - sambee.net`
   - Permissions: Account, Cloudflare Pages, edit
1. Save that Pages API token for `CLOUDFLARE_API_TOKEN`
1. Record the Cloudflare account ID for the account that owns the Pages project. You will later store that account ID in `CLOUDFLARE_ACCOUNT_ID`.

## Add GitHub Secrets

After Cloudflare is ready, open the GitHub repository settings, go to **Secrets and variables** > **Actions**, and add these repository secrets:

- `CLOUDFLARE_API_TOKEN` for the Cloudflare API token used by the Pages deploy step.
- `CLOUDFLARE_ACCOUNT_ID` for the Cloudflare account that owns the Pages project.
- `CLOUDFLARE_PAGES_PROJECT` for the Cloudflare Pages project name passed to `wrangler pages deploy`.

## CI Deploy

The deploy job publishes `website/public` to Cloudflare Pages from the `main` branch.

## Repository Preconditions

Before deployment can publish correct media:

- Source images live under `website/assets/images/`.
- Generated WebP derivatives are committed in sibling `generated/` directories.
- Downloadable files live under `website/static/files/`.
- `npm run images:validate` passes.
- The site build produces `website/public/images/` and `website/public/files/`.

For local verification:

```bash
cd website
git lfs pull
npm ci
npm run build
```

## Current Asset Behavior

The generated site still uses site-relative asset paths such as `/images/...` and `/files/...`.

That means this workflow deploys the website to Cloudflare Pages, but it does not rewrite asset URLs to a separate CDN hostname.
