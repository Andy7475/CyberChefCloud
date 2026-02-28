# Google Cloud Setup Guide for CyberChef

To use Google Cloud capabilities (like Google Translate) within CyberChef, you need to configure a Google Cloud Project and obtain an authentication string (either an API Key or an OAuth Token). 

## Method 1: API Key (Recommended for simplicity)

1. **Create a Project:**
    - Go to the [Google Cloud Console](https://console.cloud.google.com/).
    - Click on the project dropdown at the top and select **New Project**.
    - Name your project (e.g., `cyberchefcloud`) and click **Create**.

2. **Enable the API:**
    - In the Cloud Console search bar, type **"Cloud Translation API"** and select it.
    - Click **Enable**.
    - *(Note: You will need to have billing enabled on your Google Cloud account for the Translation API, even for the free tier).*

3. **Create the API Key:**
    - Navigate to **APIs & Services > Credentials** in the left sidebar.
    - Click **+ CREATE CREDENTIALS** at the top and select **API Key**.
    - Your API Key will be generated. Copy this key; you will need it for the CyberChef "GCP Auth String" input.

4. **Secure the API Key (CRITICAL):**
    - Since CyberChef runs entirely in your browser, your API Key will be visible to anyone you share your CyberChef recipe with or who inspects the network traffic. you **MUST** restrict it.
    - Click on the newly created API Key to edit its settings.
    - Under **Application restrictions**, select **Websites**.
    - Under **Website restrictions**, click **ADD**.
    - Enter the URLs where your CyberChef instance is hosted (e.g., `https://gchq.github.io/CyberChef/*` or `http://localhost:8080/*` for local testing).
    - Under **API restrictions**, select **Restrict key**.
    - Check the box for **Cloud Translation API**.
    - Click **SAVE**.

## Method 2: Temporary OAuth Token (Recommended for Security)

If you have the Google Cloud SDK (`gcloud`) installed locally and you are authorized in your project, you can generate a short-lived token to use instead of an API Key. This is much more secure because the token expires automatically.

1. Ensure you are logged into your `gcloud` CLI:
   ```bash
   gcloud auth login
   ```
2. Generate an access token:
   ```bash
   gcloud auth print-access-token
   ```
3. Copy the output token and paste it into the CyberChef "GCP Auth String" input, making sure to change the "Auth Type" dropdown to **OAuth Token**.
