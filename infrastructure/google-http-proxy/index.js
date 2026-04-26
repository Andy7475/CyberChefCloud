const express = require('express');
const cors = require('cors');

const app = express();

// Middleware
const allowedOrigins = ['https://andy7475.github.io'];
app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1 && !origin.startsWith('http://localhost:')) {
            return callback(new Error('CORS policy does not allow access from this Origin.'), false);
        }
        return callback(null, true);
    }
}));
// We might receive large payloads, increase limit if necessary
app.use(express.json({ limit: '50mb' })); 

app.post('/', async (req, res) => {
    try {
        const { targetUrl, method, headers, body, maxCharacters, showResponseMetadata } = req.body;

        if (!targetUrl) {
            return res.status(400).json({ error: 'targetUrl is required' });
        }

        const config = {
            method: method || 'GET',
            headers: headers || {},
        };

        if (config.method !== 'GET' && config.method !== 'HEAD' && body) {
            config.body = body;
        }

        const response = await fetch(targetUrl, config);
        
        let responseText = await response.text();

        // Truncate if maxCharacters is provided and greater than 0
        if (maxCharacters && maxCharacters > 0 && responseText.length > maxCharacters) {
            responseText = responseText.substring(0, maxCharacters);
        }

        // Prepare response back to CyberChef
        if (showResponseMetadata) {
            const exposedHeaders = {};
            for (const [key, value] of response.headers.entries()) {
                exposedHeaders[key] = value;
            }
            return res.json({
                status: response.status,
                statusText: response.statusText,
                headers: exposedHeaders,
                body: responseText
            });
        }

        res.send(responseText);

    } catch (err) {
        console.error('Error fetching target URL:', err);
        res.status(500).json({ error: err.toString() });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Google HTTP Proxy listening on port ${PORT}`);
});
