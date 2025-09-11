const axios = require('axios');
require('dotenv').config();

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-medium';

if (!MISTRAL_API_KEY) {
    console.error('❌ MISTRAL_API_KEY is missing from environment variables.');
    process.exit(1);
}

/**
 * Send a prompt to the Mistral API and get the generated SQL query or answer.
 * @param {string} prompt - The user question or task description.
 * @returns {Promise<{ generated_query: string }>}
 */
async function query(prompt) {
    try {
        const response = await axios.post(
            MISTRAL_API_URL,
            {
                model: MISTRAL_MODEL,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2,
            },
            {
                headers: {
                    'Authorization': `Bearer ${MISTRAL_API_KEY}`,
                    'Content-Type': 'application/json',
                }
            }
        );

        const content = response.data.choices[0].message.content.trim();
        return { generated_query: content };

    } catch (err) {
        console.error('❌ Mistral API error:', err.response?.data || err.message);
        throw new Error('Failed to get response from Mistral AI');
    }
}

module.exports = { query };
