# Anime Release Calendar

A fast, storage-free anime release calendar. It fetches upcoming airing data from AniList directly in the browser, displays it in the visitor's local timezone, and exports the current view as an iCalendar file.

The deployed product has no accounts, database, server-managed reminders, or user-data collection. It is a static Cloudflare Worker deployment.

## Run locally

```bash
npm install
npm run dev:static
```

Open the local URL shown by Wrangler. The app asks AniList for the next fourteen days of releases on page load.

## Deploy

```bash
npm run deploy
```

The Worker config publishes `public/`. After the first deployment, add `anime.hemanthga.com` as its custom domain in Cloudflare, then submit `https://anime.hemanthga.com/sitemap.xml` to Google Search Console.

## Search visibility

The static page includes a search-focused title and description, canonical URL, robots policy, sitemap, and WebApplication structured data. These are the correct technical signals for searches such as "anime release calendar", but rankings cannot be guaranteed or immediate.

## Archived version

The previous Express, SQLite, authentication, reminder, email, and OAuth implementation remains in source and repository history. It is not used by the static deployment.
