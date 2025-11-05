# Emergency alternative hosting (no backend changes)

This app is 100% static and talks to Firebase (Firestore/Auth) via the browser SDK, so we can host the same `public/` folder on any static host with zero code changes.

## Option A — Netlify (fastest via UI)
1. Create a Netlify account and click "New site from Git" or "Deploy manually".
2. If deploying manually: drag-and-drop the `public/` folder in the Netlify dashboard.
3. If using Git: push this repo, select it in Netlify, set:
   - Build command: none
   - Publish directory: `public`
4. After deploy, you'll get a `https://<name>.netlify.app` URL.
5. Custom domain: add `app.swashcleaning.co.uk` (or `system.swashcleaning.co.uk`) in Netlify → Domain settings and follow the DNS CNAME instructions (target will be the Netlify subdomain).

Netlify config (already in repo): `netlify.toml` publishes `public/` and sets headers for `service-worker.js` and `/assets/*`.

## Option B — Vercel
1. Create a Vercel account → "Add New..." → Project.
2. Import this repo. In Project Settings, set the **Root Directory** to `/` and the **Output/Build** as static:
   - No build command
   - Framework: Other
   - Output directory: `public`
3. Deploy to get `https://<name>.vercel.app`.
4. Custom domain: add it in Vercel → Domains and follow the CNAME instructions.

Vercel config (already in repo): `vercel.json` routes all requests to `/public/*`.

## Firebase services remain the same
- We do NOT change Firestore/Auth. The existing `firebaseConfig` continues to point at the same project `swash-app-436a1`.
- Only the static host (CDN) changes.

## DNS reminder for custom domain
- For Firebase Hosting and Vercel/Netlify, a subdomain like `app.swashcleaning.co.uk` typically uses a **CNAME** record.
- Propagation can take 5–30 minutes (rarely up to 60). During cutover, test in Incognito.

## Rollback
- You can leave this file and configs in the repo. When Firebase Hosting is fixed, you can keep the alternative host as a standby or switch DNS back.