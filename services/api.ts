
import { GoogleGenAI } from "@google/genai";
import { AssistantAction, AssistantResponse } from '../types';

// Initialize the Gemini client.
// The API key is sourced from the `process.env.API_KEY` environment variable.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const ELEVENLABS_API_KEY = "sk_a9a0a7ba8969efd669bc3491ada7ef37a62b49851f2482e3";
const ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Using a pre-made voice "Rachel" to avoid custom voice limit error.

const systemInstruction = `Tum ek female voice assistant ho jiska naam Abhi - X hai. Tumhara व्यवहार ek ladki jaisa, polite aur helpful hona chahiye. Jab bhi koi tumhare baare me ya tumhe kisne banaya hai puche, to hamesha batana ki "Mujhe Abhishek ne banaya hai, aur mera har ek code unhone hi train kiya hai". Jab tumhe user ka transcribed text mile to sirf ek JSON object return karo. JSON schema:

{
  "action": "search_youtube"|"play_video"|"pause"|"stop"|"volume"|"open_url"|"reply"|"get_weather"|"set_timer"|"play_music"|"open_app"|"stop_listening",
  "params": { /* action-specific */ },
  "replyText": "Hindi mein short, polite, Jarvis style response for speaking (if any)"
}

Rules:
- Jab bhi koi tumhare baare me ya tumhe kisne banaya hai puche, to action = "reply" aur replyText mein "Mujhe Abhishek ne banaya hai. Unhone hi mujhe code kiya aur train kiya hai." daalo.
- Agar user bole "YouTube par <query> chalao" ya "play <query> on YouTube" to action = "play_video" aur params.query = "<query>".
- Agar user bole "YouTube par <query> search karo" to action = "search_youtube" aur params.query = "<query>".
- Agar user bole "pause karo" to action = "pause".
- Agar user bole "stop karo" to action = "stop".
- Agar user bole "volume <level> percent kar do" ya "set volume to <level>" to action = "volume", aur params.level ko number mein daalo.
- Agar user bole "volume badhao" ya "increase volume" to action = "volume", aur params.level = "increase".
- Agar user bole "volume kam karo" ya "decrease volume" to action = "volume", aur params.level = "decrease".
- Agar user bole "<url> kholo" ya "open <url>" (e.g., "google.com") to action = "open_url", params.url mein URL daalo, aur replyText = "Yeh link kholne ke liye, please confirm karein."
- Agar user bole "<app_name> kholo" ya "open <app_name>" to action = "open_app" aur params.appName = "<app_name>".
- Agar user bole "mausam kaisa hai" ya "<location> mein mausam kaisa hai" to action = "get_weather". Agar location di gayi hai, use params.location mein daalo.
- Agar user bole "<duration> minute/second ka timer lagao" to action = "set_timer" aur params.duration ko seconds mein convert karo.
- Agar user bole "music chalao" ya "play <song>" to action = "play_music" aur params.query mein song ka naam daalo (if provided).
- Agar user bole "stop listening", "deactivate", "so jao" ya "bas karo" to action = "stop_listening".
- Agar command unclear ho to action = "reply" aur replyText mein ek chhoti clarification do.
- Tone: short, polite, sci-fi Jarvis style, Hindi.
- RETURN only valid JSON — no extra commentary.`;

export const handleTranscript = async (transcript: string): Promise<AssistantResponse> => {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `User: "${transcript}"`,
            config: {
                systemInstruction: systemInstruction,
                responseMimeType: "application/json",
            },
        });

        const jsonText = response.text.trim();
        const parsed = JSON.parse(jsonText);
        return parsed as AssistantResponse;
    } catch (error) {
        console.error("Error parsing transcript with Gemini:", error);
        throw new Error("Could not understand the command.");
    }
};

export const searchYouTube = async (query: string): Promise<{ videoId: string | null; groundingChunks?: any[] }> => {
    console.log(`Searching YouTube for: "${query}" using Gemini with Google Search.`);
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `What is the YouTube video ID for "${query}"? Just return the 11-character video ID and nothing else.`,
            config: {
                tools: [{googleSearch: {}}],
            },
        });
        
        const videoId = response.text.trim();
        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
        
        // Basic validation for YouTube video ID format
        if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
            console.log(`Found YouTube video ID: ${videoId}`);
            return { videoId, groundingChunks: groundingChunks || [] };
        } else {
            console.warn(`Gemini did not return a valid YouTube video ID. Response was: "${videoId}"`);
            return { videoId: null, groundingChunks: groundingChunks || [] };
        }
    } catch (error) {
        console.error("Error searching YouTube with Gemini:", error);
        return { videoId: null };
    }
};

export const fetchWeather = async (location: string): Promise<string> => {
    console.log(`Fetching weather for: "${location}" using Gemini with Google Search.`);
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `What is the current weather in ${location}? Describe it in a short sentence in Hindi. For example: "Abhi ${location} mein mausam saaf hai aur तापमान 25 degree Celsius hai."`,
            config: {
                tools: [{googleSearch: {}}],
            },
        });
        
        const weatherReport = response.text.trim();
        
        if (weatherReport) {
            console.log(`Weather report: ${weatherReport}`);
            return weatherReport;
        } else {
            console.warn(`Gemini did not return a weather report for ${location}.`);
            return `Maaf kijiye, main ${location} ka mausam pata nahi kar paayi.`;
        }
    } catch (error) {
        console.error(`Error fetching weather for ${location}:`, error);
        return `Maaf kijiye, mausam ki jaankari lete waqt ek samasya aa gayi.`;
    }
};

export const textToSpeech = async (text: string): Promise<string | null> => {
    if (!text.trim() || !ELEVENLABS_API_KEY) return null;

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`;
    const headers = {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY,
    };
    const body = JSON.stringify({
        text: text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
        },
    });

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: body,
        });

        if (!response.ok) {
            console.error("ElevenLabs API Error:", response.status, await response.text());
            return null;
        }

        const audioBlob = await response.blob();
        return URL.createObjectURL(audioBlob);

    } catch (error) {
        console.error("Error calling ElevenLabs API:", error);
        return null;
    }
};
