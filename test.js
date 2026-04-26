async function run() {
    const requestPayload = {
        targetUrl: 'https://example.com',
        method: 'GET',
        headers: {},
        body: undefined,
        maxCharacters: null,
        showResponseMetadata: false
    };

    const proxyUrl = "https://google-http-proxy-593556123914.europe-west2.run.app";

    const response = await fetch(proxyUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(requestPayload)
    });

    const rawText = await response.text();
    console.log("Raw text from proxy:", rawText);
    
    let data = JSON.parse(rawText);
    console.log("Parsed data:", data);
    console.log("data.body type:", typeof data.body);
    console.log("data.body preview:", String(data.body).substring(0, 50));
}

run().catch(console.error);
