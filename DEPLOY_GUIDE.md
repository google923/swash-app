# Swash Deploy Guide

Use this quick guide to know when you must deploy, and where, to see your changes live.

## Where is the app hosted?
- Firebase Hosting (primary):
  - Production: https://system.swashcleaning.co.uk (custom domain) and https://swash-app-436a1.web.app
- Vercel (secondary mirror):
  - Production: project URL in your Vercel account (e.g., https://<project>.vercel.app)

## When do I need to deploy?
- Edited any client files (.html, .js, .css, assets):
  - Firebase: required to see changes on the Firebase domain
  - Vercel: required to see changes on the Vercel domain
- Changed serverless functions under `api/`:
  - Vercel: required (functions run on Vercel)

## One-liners (Windows PowerShell)
```
# Firebase Hosting
firebase deploy --only hosting

# Vercel Production
npx vercel --prod --yes
```

## Autodeploy helper
- `node autodeploy.js` watches files and deploys to Firebase automatically.
- It attempts Vercel deploy as well unless `VERCEL_ENABLED=0`.
- If Vercel deploy is disabled or not linked, the script prints a reminder with the exact command to run.

## Decision tree
- Do you test on system.swashcleaning.co.uk?
  - Yes → Deploy to Firebase Hosting.
- Do you test on the Vercel domain?
  - Yes → Deploy to Vercel too.
- Touched `api/*.js`?
  - Yes → Deploy to Vercel (these are serverless functions).

## Tips
- Service worker can cache aggressively. If you don’t see changes, hard refresh (Ctrl+Shift+R).
- If you see a permissions error from Firestore, verify rules and sign-in state; redeploy won’t change rules unless you deploy rules specifically.
