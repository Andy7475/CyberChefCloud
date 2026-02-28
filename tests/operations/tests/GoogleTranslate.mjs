import TestRegister from "../../lib/TestRegister.mjs";

TestRegister.addTests([
    {
        name: "Google Translate: Missing Auth String",
        input: "Hello world",
        expectedError: "Error: Please provide a valid GCP Auth String (API Key or OAuth Token).",
        recipeConfig: [
            {
                "op": "Google Translate",
                "args": [
                    "en",
                    "es",
                    "API Key",
                    ""
                ]
            }
        ]
    }
]);
