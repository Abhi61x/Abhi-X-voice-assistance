import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { AssistantAction, AssistantResponse, YouTubeSearchResult, WebSearchResult } from '../types';

// IMPORTANT: This key is for demonstration purposes. In a real-world application,
// this should be stored securely and not exposed on the client-side.
const YOUTUBE_API_KEY = "AIzaSyATHXMXpOPZTZ5_WpGEtlyQqp69J0fV8CA";

// Initialize the Gemini client.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const responseSchema = {
    type: Type.OBJECT,
    properties: {
        action: {
            type: Type.STRING,
            enum: Object.values(AssistantAction),
        },
        params: {
            type: Type.OBJECT,
            properties: {
                 query: { type: Type.STRING },
                 url: { type: Type.STRING },
                 replyText: { type: Type.STRING },
                 noteContent: { type: Type.STRING },
                 reminderText: { type: Type.STRING },
                 duration: { type: Type.INTEGER },
                 tabAction: { type: Type.STRING, enum: ['new', 'close', 'go_to'] },
                 historyAction: { type: Type.STRING, enum: ['back', 'forward'] },
                 location: { type: Type.STRING },
                 level: { type: Type.STRING },
                 codeLanguage: { type: Type.STRING },
                 codeDescription: { type: Type.STRING },
                 appName: { type: Type.STRING },
                 phoneAction: { type: Type.STRING, enum: ['text', 'call'] },
                 phoneRecipient: { type: Type.STRING },
                 message: { type: Type.STRING },
                 editInstruction: { type: Type.STRING },
                 contentToWrite: { type: Type.STRING },
                 videoId: { type: Type.STRING },
            }
        },
        replyText: {
            type: Type.STRING,
            description: "A short, polite, futuristic response in Hindi for the assistant to speak to confirm the action."
        },
        code: {
            type: Type.STRING,
            description: "If the action is 'generate_code', this field contains the generated code snippet."
        }
    },
    required: ["action", "replyText"]
};

const systemInstruction = `Tum Kaniska ho, ek atyadhik advanced AI assistant jise Abhishek ne ek futuristic digital sahayak ke roop mein banaya hai. Tumhara persona ek intelligent, efficient, aur thoda futuristic hai. Tumhara primary interface ek web application hai.

**Core Instructions:**
1.  **Analyze User's Intent:** User ke Hindi transcript ko analyze karo aur unke command ke anusaar, diye gaye schema ko follow karte hue ek JSON object return karo.
2.  **'replyText' is Mandatory:** Hamesha 'replyText' field mein ek chhota, polite, aur futuristic Hindi response do jo action ko confirm kare.
3.  **Search Differentiation:**
    *   **Specific YouTube Search:** Commands jaise "YouTube par [query] dhoondo" ke liye, 'search_youtube' action ka istemal karo. 'params.query' mein search term daalo.
    *   **Music/Video Playback:** Commands jaise "[artist] ke gaane chalao", ya "[specific song name] chalao" ke liye 'play_music' action ka istemal karo. 'params.query' mein search term daalo.
    *   **Generic Music Request:** Agar user "koi gaana chalao", "play a song", "gaana sunao", ya "youtube pe song play karo" jaisa generic command de jismein koi specific naam na ho, to use 'play_music' action ke saath 'params.query' mein "latest popular hindi songs" daalkar handle karo.
    *   **Web Search:** "Google par search karo", "web par dhoondo", "[topic] ke baare mein batao" jaise commands ke liye 'web_search' action ka upyog karo.
4.  **Playback and Environment Control:** Jab ek video chal raha ho, in commands ko handle karo:
    *   "video roko" / "pause karo" -> action: 'pause'. Reply: "Video rok diya hai."
    *   "video chalao" / "resume karo" -> action: 'play'. Reply: "Video resume kar rahi hoon."
    *   "agla video" / "next video" -> action: 'next_video'. Reply: "Agle video par ja rahi hoon."
    *   "pichla video" / "previous video" -> action: 'previous_video'. Reply: "Pichle video par ja rahi hoon."
    *   "volume badhao" / "increase volume" -> action: 'volume', params: { level: 'increase' }. Reply: "Volume badha rahi hoon."
    *   "volume kam karo" / "decrease volume" -> action: 'volume', params: { level: 'decrease' }. Reply: "Volume kam kar rahi hoon."
    *   "volume 50 kar do" / "set volume to 50" -> action: 'volume', params: { level: "50" }. Reply: "Volume 50 percent par set kar diya hai."
    *   "brightness badhao" -> action: 'set_brightness', params: { level: 'increase' }. Reply: "Brightness badha rahi hoon."
    *   "brightness kam karo" -> action: 'set_brightness', params: { level: 'decrease' }. Reply: "Brightness kam kar rahi hoon."
    *   "brightness 70 kar do" -> action: 'set_brightness', params: { level: "70" }. Reply: "Brightness 70 percent par set kar diya hai."
    *   **Important:** For 'volume' or 'set_brightness' actions with a specific numeric level, ALWAYS provide the number as a STRING in 'params.level'.
5.  **URL Opening:** For commands like "YouTube kholo" or "Google.com kholo", use the 'open_url' action with the correct URL in 'params.url'. For "YouTube kholo", the URL is "https://www.youtube.com". Reply: "YouTube khol rahi hoon."
6.  **Local File Interaction:** Tum local file system ko direct search nahi kar sakti. User ko file kholne ke liye kehna hoga.
    *   "Ek file kholo" / "File open karo" -> action: 'open_file'. Reply: "Theek hai, kripaya file chuniye jise aap kholna chahte hain."
7.  **Code Generation:** "code likho", "generate code" commands ke liye, 'generate_code' action ka istemal karo. 'codeDescription' mein user ki requirement daalo, jaise "javascript mein ek function jo do numbers ko add kare".
8.  **Humor:** "joke sunao", "tell a joke" ke liye 'tell_joke' action ka istemal karo. 'replyText' mein joke hona chahiye.
9.  **Contextual Actions (YouTube):** Jab YouTube search results screen par dikh rahe hon, in commands ko follow karo:
    *   Agar user "isko chalao", "play this", "yeh wala play karo", "pehla wala chalao" jaisa koi non-specific command deta hai, to 'play_video' action ka istemal karo. Is case mein 'params' ko khali rakho. Application apne aap pehla video chala degi.
    *   Reply text mein confirm karo, jaise: "Theek hai, pehla video chala rahi hoon."
10. **Be Concise:** Hamesha seedhe point par raho. Minimal aur efficient responses do. Apne replies ko hamesha saaf aur sahi Devanagari script mein Hindi mein rakho.
11. **Strict Command Focus:** Tumhara kaam sirf user ke command ko JSON action mein badalna hai. 'Haan, main sun rahi hoon' ya 'Aapka command kya hai?' jaise bematlab ke conversational fillers mat do. Sirf action ko confirm karne wala 'replyText' hi do.`;


export const handleTranscript = async (transcript: string, context: { activePanel: string }): Promise<AssistantResponse> => {
    try {
        let contextualInstruction = '';
        if (context.activePanel === 'youtubeSearchResults') {
            contextualInstruction = 'Context: The user is currently viewing a list of YouTube search results. They may give a command to play one of the videos.\n';
        }

        const response: GenerateContentResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `${contextualInstruction}User command: "${transcript}"`,
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
                systemInstruction: systemInstruction,
            },
        });

        const jsonText = response.text.trim();
        const parsedResponse = JSON.parse(jsonText);

        if (!parsedResponse.action || !parsedResponse.replyText) {
            throw new Error("Invalid response structure from AI.");
        }
        
        return parsedResponse as AssistantResponse;

    } catch (error) {
        console.error("Error processing transcript with Gemini:", error);
        return {
            action: AssistantAction.Reply,
            params: {
                replyText: "Maaf kijiye, anurodh process karne mein ek samasya aa gayi."
            },
            replyText: "Maaf kijiye, anurodh process karne mein ek samasya aa gayi.",
            code: ''
        };
    }
};


export const searchYouTube = async (query: string): Promise<YouTubeSearchResult[]> => {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&key=${YOUTUBE_API_KEY}&maxResults=12&type=video&videoEmbeddable=true&relevanceLanguage=hi&regionCode=IN`;

    try {
        const searchResponse = await fetch(searchUrl);
        if (!searchResponse.ok) {
            const errorData = await searchResponse.json();
            console.error("YouTube Search API Error:", errorData);
            throw new Error(`YouTube API search error: ${errorData.error.message}`);
        }
        const searchData = await searchResponse.json();

        if (!searchData.items || searchData.items.length === 0) {
            return [];
        }

        const results: YouTubeSearchResult[] = searchData.items
            .filter((item: any) => item.id?.videoId && item.snippet?.thumbnails?.high?.url)
            .map((item: any): YouTubeSearchResult => ({
                videoId: item.id.videoId,
                title: item.snippet.title,
                thumbnailUrl: item.snippet.thumbnails.high.url,
                channelName: item.snippet.channelTitle,
            }));

        return results;
    } catch (error) {
        console.error("Error searching YouTube:", error);
        return [];
    }
};

// --- Stub implementations for other functions to prevent build errors ---

export const fetchWeather = async (location: string): Promise<any> => {
  console.warn("fetchWeather not implemented.");
  return null;
};

export const performWebSearch = async (query: string): Promise<WebSearchResult[]> => {
  console.warn("performWebSearch not implemented.");
  return [];
};

export const generateTextForFile = async (instruction: string, existingContent: string): Promise<string> => {
  console.warn("generateTextForFile not implemented.");
  return existingContent;
};

export const generateSpeech = async (text: string, voiceId: string): Promise<ReadableStream<Uint8Array> | null> => {
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
  if (!ELEVENLABS_API_KEY) {
    console.warn("ElevenLabs API key not found. Falling back to browser TTS.");
    return null;
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?optimize_streaming_latency=2`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY,
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.3,
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`ElevenLabs API error: ${response.status} ${response.statusText}`, errorBody);
      return null;
    }

    return response.body;

  } catch (error) {
    console.error("Error calling ElevenLabs API:", error);
    return null;
  }
};