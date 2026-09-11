# 幹飯人

幹飯人 is a mobile-first meetup planner for GitHub Pages. People can mark available dates in month, week, or two-week views, see group overlap, chat, suggest restaurants, and vote. A password-protected admin controls the meetup title and date range. Schedule, chat, and restaurant voting are stacked on one continuous page.

The app is plain HTML, CSS, and JavaScript, so there is no build step and no hosting bill. It uses GitHub Pages for the site and Supabase for shared data and anonymous user sessions. Without Supabase configuration it opens in a clearly labeled, single-device demo mode. On the first demo admin unlock, the browser asks you to create a local demo password; it is not committed to the repository.

## Run locally

Serve the `dist` folder with any static server. For example:

```powershell
python -m http.server 4173 --directory dist
```

Then open `http://localhost:4173`.

## Turn on shared mode

1. Create a Supabase project.
2. Run `supabase/schema.sql` in Supabase's SQL Editor.
3. In the SQL Editor, run `select public.set_admin_password('YOUR_PASSWORD');`, replacing `YOUR_PASSWORD` with your chosen password. Enter this directly in Supabase; do not save the command in the public repository.
4. In Supabase, open **Authentication → Providers** and enable **Anonymous Sign-Ins**.
5. Copy the project's URL and public anon key from **Project Settings → API** into `dist/config.js`.

The anon key is intended for browser use. The included Row Level Security policies protect admin-only changes and keep each person's availability and votes tied to their own session. A successful password check creates a 12-hour admin session for that anonymous user. The password is salted and hashed inside Supabase, and changing it immediately invalidates every existing admin session. Never place a Supabase service-role key in this repository.

## Publish with GitHub Pages

1. Push this folder to a GitHub repository whose default branch is `main`.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, select **GitHub Actions** as the source.
4. The included workflow publishes `dist` after each push to `main`.

On GitHub Free, Pages requires a public repository. Supabase's free plan is intended for small sites and hobby projects; inactive free projects may pause, so open the Supabase dashboard if the shared site has been unused for a while.

## Files

- `dist/index.html` — app interface
- `dist/styles.css` — responsive visual design
- `dist/app.js` — calendar, chat, voting, storage adapters, and WebMCP tools
- `dist/config.js` — Supabase public connection values
- `supabase/schema.sql` — database tables, realtime configuration, and security policies
- `.github/workflows/pages.yml` — GitHub Pages deployment

## Data and privacy

Anyone with the site link can join anonymously, choose a display name, and read the meetup's shared content. Do not use the comments for sensitive information. The admin password is verified inside Supabase and is never stored as plain text in the public site files.
