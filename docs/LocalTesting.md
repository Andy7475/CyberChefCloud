# Local Testing Guide for CyberChef

If you are developing new Cloud API capabilities (like the Google Translate operation) and you want to test them locally on your machine, follow these steps to spin up the local CyberChef development server.

## Prerequisites

1. **Node.js**: Ensure you have Node.js installed. CyberChef requires Node 16 or later.
   ```bash
   node -v
   ```
2. **NPM**: Ensure you have npm installed.
   ```bash
   npm -v
   ```

## Setup and Running

1. **Install Dependencies:**
   Open a terminal, navigate to the `CyberChefCloud` directory, and run:
   ```bash
   npm install
   ```
   *This might take a minute as it downloads everything required to build CyberChef.*

2. **Start the Development Server:**
   Run the following command to start the local instance:
   ```bash
   npm run start
   ```
   *This will run a Grunt task that compiles the web interface, resolves operations, and provisions a local HTTP server using Webpack Dev Server.*

3. **Access CyberChef:**
   By default, the server will host CyberChef on port 8080.
   - Open your web browser.
   - Go to `http://localhost:8080`.

## Testing the Translate Operation

1. With the local CyberChef instance open, type "Google Translate" into the **Operations** search bar in the top left.
2. Drag the `Google Translate` operation into the **Recipe** column.
3. In the **Input** column, type some text (e.g., "Hello world").
4. In the `Google Translate` operation configuration:
   - Make sure **Source Language** is correct (e.g., `en`).
   - Make sure **Target Language** is correct (e.g., `es`).
   - If using an API key, leave Auth Type as **API Key** and paste your API key into the **GCP Auth String** box.
   - *(Note: Ensure your API key restrictions at console.cloud.google.com temporarily allow `http://localhost:8080/*`).*
5. Check the **Manual Bake** checkbox at the bottom of the recipe column if it isn't checked by default, or just click **Bake!**.
6. The translated output should appear in the **Output** column.

## Advanced Testing (Command Line)

To ensure the CyberChef engine builds cleanly and passes its internal checks without UI verification, you can run the automated tests:
```bash
npm run test
```
