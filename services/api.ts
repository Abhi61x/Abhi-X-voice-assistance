
import { GoogleGenAI, Type } from "@google/genai";
import { AssistantAction, AssistantResponse, YouTubeSearchResult } from '../types';

// Initialize the Gemini client.
// The API key is sourced from the `process.env.GEMINI_API_KEY` environment variable.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SEARCHAPI_API_KEY = process.env.SEARCHAPI_API_KEY;

const responseSchema = {
    type: Type.OBJECT,
    properties: {
        action: {
            type: Type.STRING,
            enum: Object.values(AssistantAction),
            description: "The action for the assistant to perform."
        },
        params: {
            type: Type.OBJECT,
            description: "Parameters for the action. Varies based on the action.",
            properties: {
                 query: { type: Type.STRING },
                 url: { type: Type.STRING },
                 duration: { type: Type.INTEGER },
                 appName: { type: Type.STRING },
                 location: { type: Type.STRING },
                 level: { type: Type.STRING, description: "Volume level. Can be a number '0'-'100', or the string 'increase' or 'decrease'." }
            }
        },
        replyText: {
            type: Type.STRING,
            description: "A short, polite, futuristic response in Hindi for the assistant to speak."
        }
    },
    required: ["action", "replyText"]
};

const systemInstruction = `Tum Abhi-X ho, ek advanced AI assistant jise Abhishek ne banaya hai. Tumhari persona Jarvis jaisi hai: concise, efficient, futuristic, aur polite.
User ke Hindi transcript ko analyze karo aur unke command ke anusaar, diye gaye schema ko follow karte hue ek JSON object return karo.

Key Instructions:
- 'replyText' hamesha ek chhota, polite, aur futuristic Hindi response hona chahiye jo action ko confirm kare.
- Agar user tumhare creator ke baare mein pooche, to action "reply" use karo aur replyText mein "Mera nirman creator Abhishek ne kiya hai."
- Samay (duration) ko hamesha seconds mein convert karo.
- Agar command samajh na aaye, to 'reply' action ka upyog karke spashtikaran maango.
- Sirf valid JSON return karo, bina kisi extra text ke.`.trim();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function callGeminiWithRetry<T>(apiCall: () => Promise<T>): Promise<T> {
    const maxRetries = 3;
    let delay = 1000;

    for (let i = 0; i < maxRetries; i++) {
        try {
            return await apiCall();
        } catch (error: any) {
            const errorMessage = error.toString();
            // Check for common rate limiting and quota exceeded errors
            if (errorMessage.includes("429") || errorMessage.includes("RESOURCE_EXHAUSTED") || errorMessage.toLowerCase().includes("quota")) {
                if (i < maxRetries - 1) {
                    console.warn(`Gemini API rate limit exceeded. Retrying in ${delay / 1000}s... (Attempt ${i + 1}/${maxRetries})`);
                    await sleep(delay);
                    delay *= 2; // Exponential backoff
                } else {
                    console.error("Gemini API call failed after multiple retries due to rate limiting/quota.", error);
                    // Throw a user-friendly error in Hindi after the final retry fails.
                    throw new Error("Gemini API ka kota samapt ho gaya hai. Kripya apna account plan aur billing jaankari jaanchein.");
                }
            } else {
                console.error("Unhandled Gemini API error:", error);
                throw error; // Re-throw other types of errors immediately
            }
        }
    }
    // This part should be unreachable due to the error throwing logic above, but is required for TypeScript.
    throw new Error("An unexpected error occurred after all retries.");
}

export const handleTranscript = async (transcript: string): Promise<AssistantResponse> => {
    try {
        const response = await callGeminiWithRetry(() => ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `User: "${transcript}"`,
            config: {
                systemInstruction: systemInstruction,
                responseMimeType: "application/json",
                responseSchema: responseSchema,
                thinkingConfig: { thinkingBudget: 0 },
            },
        }));

        const jsonText = response.text.trim();
        try {
            const parsed = JSON.parse(jsonText);
            return parsed as AssistantResponse;
        } catch (parseError) {
             console.error("Failed to parse Gemini response as JSON:", jsonText, parseError);
            throw new Error("AI se mila jawab samajh nahi aaya. Kripya punah prayas karein.");
        }
    } catch (error: any) {
        console.error("Error processing transcript with Gemini:", error.message);
        // Re-throw the specific error (e.g., the quota message or parsing error) so it can be displayed and spoken in the UI.
        throw error;
    }
};

export const searchYouTube = async (query: string): Promise<YouTubeSearchResult[]> => {
    if (!SEARCHAPI_API_KEY) {
        console.error("SearchAPI.io API key not configured.");
        throw new Error("Search API configure nahi hai. Administrator se sampark karein.");
    }
    console.log(`Searching YouTube for: "${query}" using SearchAPI.io.`);
    const searchUrl = `https://www.searchapi.io/api/v1/search?engine=google&q=${encodeURIComponent(query + ' site:youtube.com')}&api_key=${SEARCHAPI_API_KEY}`;

    try {
        const response = await fetch(searchUrl);
        if (!response.ok) {
            console.error("SearchAPI.io Error:", response.status, await response.text());
            throw new Error("Search API se sampark nahi ho pa raha hai.");
        }
        const searchResultsData = await response.json();
        
        const results: YouTubeSearchResult[] = [];
        const organicResults = searchResultsData?.organic_results || [];

        for (const result of organicResults) {
            if (result.link && result.link.includes("youtube.com/watch")) {
                const url = new URL(result.link);
                const videoId = url.searchParams.get('v');
                
                if (videoId) {
                    const title = result.title;
                    const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
                    results.push({ videoId, title, thumbnailUrl });
                }
            }
            // Limit to a reasonable number of results
            if (results.length >= 8) {
                break;
            }
        }
        
        console.log(`Found ${results.length} YouTube videos for query: "${query}"`);
        return results;

    } catch (error) {
        console.error("Error searching YouTube with SearchAPI.io:", error);
        throw new Error("YouTube search anurodh vifal raha. Network samasya ho sakti hai.");
    }
};

export const fetchWeather = async (location: string): Promise<{ weatherReport: string; }> => {
    if (!SEARCHAPI_API_KEY) {
        console.error("SearchAPI.io API key not configured.");
        throw new Error("Search API configure nahi hai. Administrator se sampark karein.");
    }
    console.log(`Fetching weather for: "${location}" using SearchAPI.io.`);
    const searchUrl = `https://www.searchapi.io/api/v1/search?engine=google&q=${encodeURIComponent('weather in ' + location)}&api_key=${SEARCHAPI_API_KEY}`;

    try {
        // Step 1: Get weather data from SearchAPI.io
        const searchResponse = await fetch(searchUrl);
        if (!searchResponse.ok) {
             console.error("SearchAPI.io Error:", searchResponse.status, await searchResponse.text());
            throw new Error("Mausam ki jaankari ke liye search API kaam nahi kar raha hai.");
        }
        const searchResults = await searchResponse.json();
        
        // Step 2: Parse weather data locally instead of calling Gemini
        const answerBox = searchResults?.answer_box;

        if (answerBox && answerBox.temperature && answerBox.weather) {
            const temp = answerBox.temperature;
            const condition = answerBox.weather;
            const reportLocation = answerBox.location || location;
            
            // Construct the report directly, removing the need for a Gemini call
            const weatherReport = `Abhi ${reportLocation} mein mausam ${condition} hai aur तापमान ${temp} degree Celsius hai.`;
            
            console.log(`Generated weather report locally: ${weatherReport}`);
            return { weatherReport };
        }

        // Fallback to using a snippet if structured data isn't available
        const weatherSnippet = answerBox?.snippet || searchResults?.organic_results?.[0]?.snippet;
        if (weatherSnippet) {
            const weatherReport = `Mausam report ke anusaar, ${location} mein: ${weatherSnippet}`;
            console.log(`Generated weather report from snippet: ${weatherReport}`);
            return { weatherReport };
        }

        // If no data is found at all
        console.warn(`SearchAPI.io did not return any weather data for ${location}.`);
        return { weatherReport: `Maaf kijiye, main ${location} ka mausam pata nahi kar paayi.` };

    } catch (error) {
        console.error(`Error fetching weather for ${location}:`, error);
        throw new Error("Mausam ki jaankari lete waqt ek network samasya aa gayi.");
    }
};