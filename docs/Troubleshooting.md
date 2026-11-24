# Google Cloud Troubleshooting Guide

## Error: "401 Anonymous caller" or "403 Permission 'storage.objects.list' denied"

If you successfully authenticated with the **Authenticate Google Cloud** operation but received a `401` or `403` error when trying to run an operation like **GCloud List Bucket** or **GCloud Read File**, the issue is **Identity and Access Management (IAM)**.

Even though your token is valid (Authentication), your Google Account does not have the necessary permissions (Authorization) to perform that specific action on that specific resource.

### How to Fix IAM Permissions

1. **Verify Your Google Login Account**
   Make sure the email address you selected in the Google Login popup is the *exact same* email address that holds permissions in your Google Cloud Project.

2. **Grant Storage Roles**
   To read from Cloud Storage, your Google Account must be granted a role that contains the required permissions (like `storage.objects.list` and `storage.objects.get`).

   - Go to the [Google Cloud Console](https://console.cloud.google.com).
   - Navigate to **IAM & Admin > IAM**.
   - Find your email address in the list of principals.
   - Click the pencil icon (Edit principal) next to your name.
   - Click **Add Another Role**.
   - To fully utilize the CyberChef Cloud Storage operations, add the **Storage Object Viewer** role (or **Storage Object Admin** if you plan to write files later).
   - Click **Save**.

   *Note: IAM changes can take anywhere from 60 seconds to a few minutes to propagate across Google's infrastructure.*

3. **Check Bucket-Level Permissions**
   If the bucket belongs to a different project than your OAuth Client ID, or has "fine-grained" access control instead of "Uniform" access control, you may need to grant yourself permission directly on the bucket itself.
   - Navigate to **Cloud Storage > Buckets**.
   - Click on the bucket you are trying to read.
   - Go to the **Permissions** tab.
   - Click **Grant Access**.
   - Add your Google email address and assign the **Storage Object Viewer** role.

4. **Retry the Operation**
   After waiting two minutes for IAM propagation, refresh CyberChef (this forces a new session and drops the old token). Re-authenticate with **Authenticate Google Cloud**, then bake the recipe again.

## "Google API relay: …" errors

Every Google API call from an operation goes through the Cloud Run relay `cyber-chef-cloud-google-api` in project `cyberchefcloud` (`infrastructure/google-api-proxy/`).
- **"Not authorised for the Google API relay"**: sign in with OAuth or an access token for an account with access to project `cyberchefcloud`. API-key-only sign-in can't be used, because the relay can't tell whose key it is.
- **"Could not reach the CyberChefCloud Google API relay"**: the relay isn't deployed or isn't reachable. Deploy it with `infrastructure/google-api-proxy/deploy.sh`, and check its logs with `gcloud run services logs read cyber-chef-cloud-google-api --project cyberchefcloud --region europe-west2 --limit 50`.

## "Network Error: Could not connect to Google APIs … Failed to fetch"

The browser got no readable response: Google's normal error replies (bad credentials, wrong project, payload too large) all carry CORS headers and show as a readable error, so "Failed to fetch" means the request was stopped before that, for example by a refused CORS preflight or a dropped connection. To check Speech-to-Text outside the browser with your gcloud login:

```bash
python3 tests/manual/speech_to_text_check.py recording.wav --project YOUR_PROJECT
```

It sends the browser's CORS preflight and then the same request the app sends, and reports both. Without a file it sends a second of silence.
