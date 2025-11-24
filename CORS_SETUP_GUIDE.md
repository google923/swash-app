# Firebase Storage CORS Configuration - Setup Guide

## Current Status: File Uploads Disabled (Temporary)

**Problem**: Firebase Storage file uploads (logo and background) are currently blocked by CORS policy errors.

**Reason**: Firebase Storage bucket requires explicit CORS (Cross-Origin Resource Sharing) configuration to accept upload requests from browser-based applications.

**Current Solution**: File uploads have been disabled in the UI. The color theme customization (banner, button, accent, tab colors) **still works perfectly**.

---

## What Works Now ✅

- ✅ Banner color customization
- ✅ Button color customization  
- ✅ Accent color customization
- ✅ Tab color customization
- ✅ Theme preview
- ✅ Save colors to Firestore
- ✅ Apply theme across all pages

## What Doesn't Work Yet ❌

- ❌ Logo file uploads
- ❌ Background image file uploads

---

## How to Re-Enable File Uploads (For Admin)

To properly enable file uploads, you need to configure CORS on the Firebase Storage bucket. There are two methods:

### Method 1: Using Firebase Console (Easiest - No Setup Required)

1. Go to: https://console.firebase.google.com/project/swash-app-436a1/storage/rules
2. Create a `cors.json` file with this content:
```json
[
  {
    "origin": [
      "https://app.swashcleaning.co.uk",
      "https://swash-app-436a1.web.app",
      "https://swash-vt3nz4i6z-christopher-wessells-projects.vercel.app",
      "http://localhost:5000",
      "http://localhost:3000"
    ],
    "method": ["GET", "HEAD", "DELETE", "PUT", "POST", "PATCH", "OPTIONS"],
    "responseHeader": ["Content-Type", "Authorization", "x-goog-meta-*"],
    "maxAgeSeconds": 3600
  }
]
```

3. Contact Google Cloud support to apply this CORS configuration, OR use Method 2

### Method 2: Using Google Cloud SDK (Recommended)

1. **Install Google Cloud SDK**:
   - Download from: https://cloud.google.com/sdk/docs/install-windows
   - Run the installer and complete setup

2. **Authenticate**:
   ```powershell
   gcloud auth login
   ```

3. **Set project**:
   ```powershell
   gcloud config set project swash-app-436a1
   ```

4. **Apply CORS configuration**:
   ```powershell
   cd c:\Users\chris\OneDrive\Desktop\Swash-app(rebuild)
   gsutil cors set cors_config.json gs://swash-app-436a1.firebasestorage.app
   ```

   > **Note**: A `cors_config.json` file has already been generated in the project root for you to use.

5. **Verify CORS was applied**:
   ```powershell
   gsutil cors get gs://swash-app-436a1.firebasestorage.app
   ```

---

## Re-Enabling Uploads in Code

Once CORS is configured, you'll need to uncomment the file upload code:

**File**: `subscriber-settings.js`

Change this section (around line 390):

```javascript
// BEFORE (disabled):
const logoInput = document.getElementById('companyLogoUpload');
if (logoInput?.files?.[0]) {
  showToast('❌ File uploads are currently disabled', 'error');
  return;
}
```

Back to the original upload logic:

```javascript
// AFTER (enabled):
const logoInput = document.getElementById('companyLogoUpload');
if (logoInput?.files?.[0]) {
  const logoFile = logoInput.files[0];
  const logoExt = logoFile.name.split('.').pop();
  const logoRef = ref(storage, `subscribers/${state.subscriberId}/logo.${logoExt}`);
  
  await uploadBytes(logoRef, logoFile);
  settings.logoUrl = await getDownloadURL(logoRef);
}
```

Then re-enable the HTML inputs in `subscriber-settings.html` by removing the `disabled` attribute and `opacity:0.5` styles from the file input elements.

---

## Why CORS is Required

CORS (Cross-Origin Resource Sharing) is a security feature that prevents websites from arbitrarily accessing resources on other domains. When your website (`app.swashcleaning.co.uk`) tries to upload files to Firebase Storage (`firebasestorage.googleapis.com`), the browser blocks it unless Firebase explicitly allows that origin via CORS headers.

---

## Temporary Workaround While Uploads Are Disabled

Users can still fully customize their theme using:
1. **Banner Color**: Primary UI color
2. **Button Color**: CTA button color
3. **Accent Color**: Secondary highlight color
4. **Tab Color**: Navigation tabs color

This provides significant branding customization while file upload configuration is being completed.

---

## Files Modified

- `subscriber-settings.html` - Disabled file inputs, added warning messages
- `subscriber-settings.js` - Added check to prevent upload attempts
- `cors_config.json` - CORS configuration template (already generated)

---

## Next Steps

1. Install Google Cloud SDK (instructions above)
2. Run the CORS setup command using `gsutil`
3. Once configured, uncomment the upload logic in the files
4. Test file uploads again

**Support**: If you encounter issues or need guidance, contact your Firebase/GCP administrator.
