# The prayer tree

A shared, swaying ASCII tree. Visitors record a spoken prayer of up to 30 seconds; it hangs as a red ribbon (§) on a random leaf, where anyone can tap it and listen. Everyone sees the same tree, and a visitor's own prayers stay findable when they come back ("Find yours").

## What's in here

- `public/index.html` – the page: animated tree, recorder, player
- `public/tree.js` – builds the tree from a fixed seed, so every visitor gets the identical tree
- `public/fonts/` – Spectral and Spline Sans Mono, both SIL Open Font License 1.1
- `netlify/functions/prayers.mjs` – `/api/prayers`: list prayers, add one, remove one (admin only)
- `netlify/functions/audio.mjs` – `/api/audio/:id`: serves a recording, cached by Netlify's CDN
- `netlify.toml` – tells Netlify where the site and functions live

Recordings and the list of prayers live in Netlify Blobs, which needs no setup. Two people hanging prayers at the same moment can't overwrite each other: the list is only saved if nobody else changed it since it was read, otherwise it retries.

## Deploy on Netlify

Netlify's drag-and-drop deploy only publishes static files, so it won't run the functions. Use one of these instead:

**From your computer**, inside this folder:

```
npm install
npx netlify-cli deploy --prod
```

The first run asks you to log in and to create a new site.

**From GitHub**: push this folder to a repository, then import it as a new project in Netlify. The settings come from `netlify.toml`.

Then, to be able to remove prayers, add an environment variable `ADMIN_KEY` with a long random value in the site's settings, and redeploy.

## Removing a prayer

Open the site with `?admin` on the end (for example `https://your-site.netlify.app/?admin`), tap the prayer, and choose **Remove this prayer**. You'll be asked for the `ADMIN_KEY` once per browser session. The recording is deleted and purged from the CDN.

## Embedding

```html
<iframe src="https://your-site.netlify.app/?embed"
        allow="microphone; autoplay"
        style="width:100%;height:720px;border:0"
        title="The prayer tree"></iframe>
```

`allow="microphone"` is required, or visitors on the host page won't be able to record. `?embed` makes the title smaller to save space.

## Limits worth knowing

- Prayers are capped at 30 seconds and 2.5 MB, and must be real audio (webm, mp4/m4a, ogg, mp3, aac).
- Each visitor can leave up to 6 prayers per 10 minutes per function instance.
- New prayers from other people appear within about a minute; your own appear instantly.
- Netlify's free plan has monthly usage limits on functions, bandwidth and Blobs. The list and recordings are cached at the CDN to keep usage low, but a very popular tree may need a paid plan.
