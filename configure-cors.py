#!/usr/bin/env python3
"""
Configure CORS on Firebase Storage bucket using gsutil
"""
import json
import subprocess
import sys

# CORS configuration
cors_config = [
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

# Write CORS config to temp file
cors_json_file = 'cors_config.json'
with open(cors_json_file, 'w') as f:
    json.dump(cors_config, f, indent=2)

print(f"📝 Created CORS configuration file: {cors_json_file}")
print(json.dumps(cors_config, indent=2))

# Try to set CORS using gsutil (if available via gcloud)
bucket_url = "gs://swash-app-436a1.firebasestorage.app"

print(f"\n⏳ Attempting to set CORS on {bucket_url}...")
print("Note: This requires gcloud/gsutil to be installed and authenticated.")
print("\nIf you see 'command not found' below, you'll need to:")
print("1. Install Google Cloud SDK from: https://cloud.google.com/sdk/docs/install")
print("2. Run: gcloud auth login")
print("3. Run: gcloud config set project swash-app-436a1")
print("4. Then run this script again")
print("\n" + "="*60 + "\n")

try:
    # Try setting CORS with gsutil
    result = subprocess.run(
        ["gsutil", "cors", "set", cors_json_file, bucket_url],
        capture_output=True,
        text=True,
        timeout=10
    )
    
    if result.returncode == 0:
        print("✅ CORS configuration successfully applied!")
        print(result.stdout)
    else:
        print("❌ Failed to set CORS:")
        print(result.stderr)
        sys.exit(1)
        
except FileNotFoundError:
    print("❌ gsutil command not found")
    print("\nTo fix CORS via Firebase Console:")
    print("1. Go to: https://console.firebase.google.com/project/swash-app-436a1/storage")
    print("2. Click on 'Rules' tab")
    print("3. Or use the Firebase Console to configure CORS via the Storage bucket settings")
    print("\nAlternatively, install gcloud SDK and run:")
    print("  gsutil cors set cors_config.json gs://swash-app-436a1.firebasestorage.app")
    sys.exit(1)
except Exception as e:
    print(f"❌ Error: {e}")
    sys.exit(1)
finally:
    # Keep the JSON file for manual reference
    print(f"\n📄 CORS configuration saved to: {cors_json_file}")
    print("   You can use this file manually if needed")
