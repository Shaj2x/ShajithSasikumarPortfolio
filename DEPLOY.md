# Putting this live

Plain static files: no build step, no dependencies, nothing to install.
Every asset path is relative, so it works from a subfolder as well as from
a domain root.

## GitHub Pages — live in about a minute

1. Settings -> Pages
2. Source: **Deploy from a branch**
3. Branch: **main**, folder: **/ (root)**, Save

It lands at `https://shaj2x.github.io/ShajithSasikumarPortfolio/`.
`.nojekyll` is in the repo so Pages serves the files as they are rather than
running them through Jekyll first.

## Vercel — if you want a custom domain

1. vercel.com -> Add New -> Project -> import this repo
2. Framework preset: **Other**
3. Build command: leave empty. Output directory: leave empty (root)
4. Deploy

`vercel.json` is already here: it sets clean URLs, security headers, and
`must-revalidate` on the assets, which matters because their filenames are
not content hashed.

Both can point at the same repo at the same time. Every push to `main`
redeploys.

## After the first deploy

`index.html` has two meta tags waiting on the real address:

    <meta property="og:url" content="PATCH_AT_DEPLOY">
    <meta property="og:image" content="PATCH_AT_DEPLOY">

They control the preview card when the link is shared. Send me the live URL
and I will fill them in.

## Releasing a change

Asset URLs carry a version stamp so a browser can never serve a stale copy:

    <script src="assets/app.js?v=20260916f"></script>

Bump that stamp and `BUILD` in `assets/app.js` together on each release.
`BUILD` is what the `?fps` panel prints, which is how you tell at a glance
whether a browser is running the release you just shipped.
