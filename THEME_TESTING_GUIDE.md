# Theme System Testing Guide

## Quick Test (5 minutes)

### 1. Login & Navigate to Settings
1. Go to: https://app.swashcleaning.co.uk/subscriber-settings.html
2. Login with subscriber credentials
3. Click "Theme Settings" tab

### 2. Test Color Preview
1. **Banner Color**: 
   - Click color picker
   - Change to different color (e.g., #FF0000)
   - ✅ Should see preview button and header color change instantly
   
2. **Button Color**:
   - Click color picker
   - Change to different color (e.g., #00FF00)
   - ✅ Should see preview button color change instantly
   
3. **Tab Color**:
   - Click color picker
   - Change to different color (e.g., #0000FF)
   - ✅ Should see tab colors change in real-time
   
4. **Accent Color**:
   - Click color picker
   - Value should update (future use)

### 3. Test Logo Upload
1. **Click logo upload** input
2. **Select an image file** (PNG or JPG, < 5MB recommended)
3. ✅ Should see preview appear in logo preview box immediately

### 4. Test Background Upload
1. **Click background image upload** input
2. **Select an image file** (PNG or JPG, < 10MB recommended)
3. ✅ Should see preview appear in background preview area immediately
4. ✅ Preview should show image covering the area (backgroundSize: cover)

### 5. Save Theme
1. **Click "Save Theme"** button
2. ✅ Button should show "Saving..." while uploading
3. ✅ Should see green toast: "✅ Theme saved and applied to all your pages"
4. ✅ Color inputs should be cleared

### 6. Test Persistence
1. **Refresh page** (Ctrl+R)
2. ✅ Colors should still be set to your custom values
3. ✅ Logo should still display (if uploaded)
4. ✅ Background should still display (if uploaded)

### 7. Test Cross-Page Application
1. **Navigate to different subscriber pages**:
   - https://app.swashcleaning.co.uk/subscriber-add-new-customer.html
   - https://app.swashcleaning.co.uk/subscriber-schedule-full.html
   - https://app.swashcleaning.co.uk/subscriber-tracking.html
   - https://app.swashcleaning.co.uk/subscriber-rep-log.html
2. ✅ All pages should show:
   - Your custom banner color in header
   - Your custom button colors on all buttons
   - Your custom tab colors
   - Your logo next to Swash logo (if uploaded)
   - Your background image (if uploaded)

### 8. Test Reset
1. **Go back to Settings**
2. **Click "Reset to Default"**
3. ✅ All color inputs should reset to default values:
   - Banner Color: #0078d7
   - Button Color: #0078d7
   - Accent Color: #22c55e
   - Tab Color: #0078d7
4. ⚠️ Note: Reset button does NOT delete files, just clears colors

## Comprehensive Test (15 minutes)

### Test 1: File Upload Validation
1. **Try uploading file > 5MB** for logo
   - Should show error or reject
2. **Try uploading file > 10MB** for background
   - Should show error or reject
3. **Try uploading unsupported file type** (e.g., .txt)
   - Should reject (only image/* accepted)

### Test 2: Replace Files
1. **Upload a logo**
2. **Wait for save to complete**
3. **Upload a different logo**
4. **Save again**
5. ✅ New logo should replace old one
6. ✅ Old file should be deleted from storage (verify in Firebase Console)

### Test 3: Error Handling
1. **Go offline** (DevTools → Network → Offline)
2. **Try to save theme**
3. ✅ Should show error toast
4. **Go back online**
5. **Try saving again**
6. ✅ Should work normally

### Test 4: Multiple Subscribers
**If you have test accounts**:
1. **Subscriber A**: Set theme to RED with logo A
2. **Subscriber B**: Set theme to BLUE with logo B
3. **Login back to Subscriber A**
4. ✅ Should see RED theme with logo A (not logo B)
5. **Login to Subscriber B**
6. ✅ Should see BLUE theme with logo B (not logo A)

### Test 5: Real-Time Color Editing
1. **Open Settings page**
2. **Don't save yet**
3. **Edit banner color** → observe header changes immediately
4. **Edit button color** → observe all buttons change immediately
5. **Edit tab color** → observe tabs change immediately
6. **Refresh page WITHOUT saving**
7. ✅ Colors should revert to saved values (real-time edits not persisted)

### Test 6: Logo Display
1. **Upload a logo**
2. **Save theme**
3. **Check all pages**:
   - Logo should appear next to Swash logo in header
   - Should not break layout (SVG or image logo)
   - Should be right-aligned in header

### Test 7: Background Image Display
1. **Upload a background image**
2. **Save theme**
3. **Navigate through all pages**
   - All pages should show background
   - Text should remain readable
4. **Scroll on pages**:
   - Background should stay fixed (parallax effect)
   - Content should scroll over background

### Test 8: Browser Cache Bypass
1. **Edit theme (don't save)**
2. **Hard refresh** (Ctrl+Shift+R)
3. ✅ Should load latest version (bypassing cache)
4. ✅ Unsaved edits should be lost

## Debug Checklist

If something doesn't work:

### 1. Check Browser Console
```javascript
// Verify theme loaded
console.log(window._subscriberTheme);
// Should show theme object with your colors

// Verify subscriber ID
console.log(localStorage.getItem('swash:lastSubscriberId'));
// Should show valid UUID

// Check for errors
// Look for red error messages in console
```

### 2. Check Network Tab
- Look for POST request when saving
- Should go to `/api/theme` or Firestore endpoint
- Response should be 200 OK

### 3. Check Firestore Console
```
Path: subscribers/{subscriberId}/settings/theme
Should show document with fields:
- bannerColor: "#..."
- buttonColor: "#..."
- accentColor: "#..."
- tabColor: "#..."
- logoUrl: "https://..." (if uploaded)
- backgroundUrl: "https://..." (if uploaded)
- updatedAt: timestamp
```

### 4. Check Firebase Storage Console
```
Path: subscribers/{subscriberId}/logo.*
Path: subscribers/{subscriberId}/background.*
Should show uploaded files
```

### 5. Check Page Source
Right-click → View Source → Look for:
- Header element with custom color
- Link to header.html template
- Script tag loading header-template.js
- Dynamic style for button colors (`subscriber-theme-styles`)

## Performance Test

### Load Time Impact
1. **Clear browser cache**
2. **Open DevTools → Performance tab**
3. **Record page load for Settings page**
4. ✅ Should be < 2 seconds total load time
5. ✅ Theme loading should < 500ms

### File Upload Speed
1. **Upload 5MB logo**
   - Should complete within 10-30 seconds (depends on internet)
2. **Upload 10MB background**
   - Should complete within 20-60 seconds (depends on internet)

## Accessibility Testing

1. **Color Contrast**:
   - Custom colors should maintain WCAG AA contrast
   - Test with: https://webaim.org/resources/contrastchecker/
   
2. **Keyboard Navigation**:
   - All controls should be keyboard accessible
   - Tab through all form fields
   
3. **Screen Reader** (NVDA, JAWS):
   - Theme settings labels should be read correctly
   - File input should be announced

## Mobile Testing

1. **Open on mobile device** or use DevTools mobile view
2. **Settings layout should be responsive**
3. **Color pickers should work on touch**
4. **File upload should work on mobile**
5. **All pages should show theme correctly on mobile**

## Edge Cases

### 1. No Theme Saved Yet
- First-time subscriber visits settings
- ✅ Color pickers should show defaults
- ✅ Previews should show defaults
- ✅ No file upload inputs filled

### 2. Old Theme Data
- Subscriber has old theme in `private/themeSettings`
- ✅ Should migrate/ignore
- ✅ Settings page should show defaults initially
- ✅ New save should use new path

### 3. Missing Files
- Subscriber deletes logo/background files in Storage
- ✅ Theme still loads
- ✅ Colors still apply
- ✅ Missing images don't break page

### 4. Concurrent Edits
- Subscriber A saves theme
- Subscriber B saves theme simultaneously
- ✅ Both themes should save correctly
- ✅ Each subscriber sees only their theme

## Troubleshooting

### Colors Not Applying
**Solution**:
1. Check `window._subscriberTheme` in console
2. If empty, theme didn't load
3. Check Firestore path: `subscribers/{id}/settings/theme`
4. Check browser cache (hard refresh)

### Logo Not Showing
**Solution**:
1. Check Storage path: `subscribers/{id}/logo.*`
2. Verify URL in Firestore `logoUrl` field
3. Try opening URL directly in browser
4. Check if image is corrupted

### Background Not Showing
**Solution**:
1. Check Storage path: `subscribers/{id}/background.*`
2. Check browser DevTools → Elements → body element
3. Look for `background-image` style
4. Verify image file isn't corrupted

### Save Button Stuck on "Saving..."
**Solution**:
1. Check Network tab for failed requests
2. Check browser console for errors
3. Hard refresh page
4. Try saving again
5. Check user permissions in Firestore

### Colors Revert After Save
**Solution**:
1. Check Firestore for saved colors
2. Verify `doc(db, 'subscribers', id, 'settings', 'theme')` path
3. Check for JavaScript errors in console
4. Try logout and login again

## Success Criteria

✅ All tests pass when:
1. Colors apply immediately and persist
2. Files upload without errors
3. Theme appears on all pages
4. Themes don't affect other subscribers
5. Page loads stay under 2 seconds
6. No JavaScript errors in console
7. Accessibility requirements met
8. Mobile layout responsive

## Next Steps

After testing:
1. Document any bugs found
2. Note any UX improvements
3. Collect feedback from actual subscribers
4. Plan future enhancements
5. Monitor performance in production
