import { GoogleGenAI, Modality } from "@google/genai";

// Get API key from Vite environment variables
const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

if (!apiKey) {
  throw new Error('Missing Gemini API key. Please set VITE_GEMINI_API_KEY in your .env file');
}

const ai = new GoogleGenAI({ apiKey });

// --- TTS Service ---
export const speakText = async (text: string): Promise<ArrayBuffer | null> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Fenrir' }, // Options: Puck, Charon, Kore, Fenrir, Aoede, Zephyr
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
        const binaryString = atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }
    return null;
  } catch (error) {
    console.error("TTS Error:", error);
    return null;
  }
};

// --- Transcription Service (Dictation) ---
export const transcribeAudio = async (audioBase64: string, mimeType: string): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: audioBase64,
            },
          },
          {
            text: "Transcribe this audio exactly as spoken. If it is in Spanish, transcribe in Spanish. If English, in English. Do not add any commentary, just return the text.",
          },
        ],
      },
    });
    return response.text || "";
  } catch (error) {
    console.error("Transcription Error:", error);
    return "";
  }
};

// --- Search Grounding / Brainstorming ---
export interface GroundingResult {
  text: string;
  sources: Array<{ uri: string; title: string }>;
}

export const brainstormTasks = async (query: string): Promise<GroundingResult> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Create a concise list of actionable todo items based on this request: "${query}". Return ONLY the list items, one per line.`,
      config: {
        tools: [{ googleSearch: {} }],
        // Enable Thinking Mode for complex planning
        thinkingConfig: { thinkingBudget: 2048 }, 
      },
    });

    const text = response.text || "No suggestions found.";
    
    const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((chunk: any) => chunk.web ? { uri: chunk.web.uri, title: chunk.web.title } : null)
      .filter(Boolean) as Array<{ uri: string; title: string }> || [];

    return { text, sources };
  } catch (error) {
    console.error("Brainstorm Error:", error);
    return { text: "Sorry, I couldn't connect to the AI.", sources: [] };
  }
};