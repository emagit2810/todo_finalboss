import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { MicIcon, MicOffIcon } from './Icons';
import { bytesToBase64, decodeAudioData } from '../utils/audio';
import { Todo } from '../types';

interface LiveVoiceAgentProps {
  todos: Todo[];
  addTodo: (text: string) => void;
  deleteTodo: (text: string) => void;
  markTodo: (text: string, completed: boolean) => void;
  minimal?: boolean; // New prop for inline mode
}

// --- Function Definitions for the Model ---
const addTodoFn: FunctionDeclaration = {
  name: 'addTodo',
  parameters: {
    type: Type.OBJECT,
    description: 'Add a new item to the todo list.',
    properties: {
      text: { type: Type.STRING, description: 'The content of the todo item.' },
    },
    required: ['text'],
  },
};

const deleteTodoFn: FunctionDeclaration = {
    name: 'deleteTodo',
    parameters: {
      type: Type.OBJECT,
      description: 'Remove an item from the todo list by fuzzy matching text.',
      properties: {
        text: { type: Type.STRING, description: 'The text of the todo to remove.' },
      },
      required: ['text'],
    },
  };

const markTodoFn: FunctionDeclaration = {
  name: 'markTodo',
  parameters: {
    type: Type.OBJECT,
    description: 'Mark a todo item as completed or incomplete.',
    properties: {
      text: { type: Type.STRING, description: 'The text of the todo.' },
      status: { type: Type.STRING, description: 'Use "complete" or "incomplete".' },
    },
    required: ['text', 'status'],
  },
};

const getTodosFn: FunctionDeclaration = {
  name: 'getTodos',
  parameters: {
    type: Type.OBJECT,
    description: 'Get the current list of todo items.',
    properties: {},
  },
};

export const LiveVoiceAgent: React.FC<LiveVoiceAgentProps> = ({ todos, addTodo, deleteTodo, markTodo, minimal = false }) => {
  const [connected, setConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs to persist objects across renders without causing re-renders
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const currentTodosRef = useRef<Todo[]>(todos);

  // Update ref when props change so the callbacks always have fresh data
  useEffect(() => {
    currentTodosRef.current = todos;
  }, [todos]);

  const stopSession = useCallback(() => {
    if (sessionPromiseRef.current) {
      sessionPromiseRef.current.then(session => {
        try {
            session.close();
        } catch (e) {
            console.warn("Session close error", e);
        }
      });
      sessionPromiseRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    sourcesRef.current.forEach(source => source.stop());
    sourcesRef.current.clear();
    setConnected(false);
    setIsSpeaking(false);
  }, []);

  const startSession = useCallback(async () => {
    try {
      setError(null);
      const apiKey = process.env.API_KEY;
      if (!apiKey) throw new Error("No API Key provided");

      const ai = new GoogleGenAI({ apiKey });
      
      // Audio Contexts
      const inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = outputAudioContext;
      nextStartTimeRef.current = 0;

      // Stream Setup
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = inputAudioContext.createMediaStreamSource(stream);
      const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);

      // Helper for Input Blob
      const createPcmBlob = (data: Float32Array) => {
        const l = data.length;
        const int16 = new Int16Array(l);
        for (let i = 0; i < l; i++) {
          int16[i] = data[i] * 32768;
        }
        const uint8 = new Uint8Array(int16.buffer);
        // Manual encode to simple binary string for btoa (no TextEncoder for binary data safely in all envs mixed with btoa)
        let binary = '';
        const len = uint8.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(uint8[i]);
        }
        return {
          data: btoa(binary),
          mimeType: 'audio/pcm;rate=16000',
        };
      };

      scriptProcessor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmBlob = createPcmBlob(inputData);
        if (sessionPromiseRef.current) {
            sessionPromiseRef.current.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
            });
        }
      };

      source.connect(scriptProcessor);
      scriptProcessor.connect(inputAudioContext.destination);

      // Initialize Session
      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            setConnected(true);
            console.log("Live API Connected");
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              setIsSpeaking(true);
              const audioCtx = audioContextRef.current;
              if (!audioCtx) return;

              const bytes = new Uint8Array(atob(base64Audio).split('').map(c => c.charCodeAt(0)));
              const audioBuffer = await decodeAudioData(bytes, audioCtx, 24000, 1);
              
              const source = audioCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(audioCtx.destination); // Direct to speakers
              
              const currentTime = audioCtx.currentTime;
              const startTime = Math.max(nextStartTimeRef.current, currentTime);
              source.start(startTime);
              nextStartTimeRef.current = startTime + audioBuffer.duration;

              sourcesRef.current.add(source);
              source.onended = () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setIsSpeaking(false);
              };
            }

            // Handle Function Calls
            const toolCall = message.toolCall;
            if (toolCall) {
              for (const fc of toolCall.functionCalls) {
                console.log("Tool Call:", fc.name, fc.args);
                let result: any = { status: 'ok' };

                if (fc.name === 'addTodo') {
                  const text = (fc.args as any).text;
                  addTodo(text);
                  result = { result: `Added todo: ${text}` };
                } else if (fc.name === 'deleteTodo') {
                    const text = (fc.args as any).text;
                    deleteTodo(text);
                    result = { result: `Deleted todo matching: ${text}` };
                } else if (fc.name === 'markTodo') {
                    const text = (fc.args as any).text;
                    const status = (fc.args as any).status;
                    markTodo(text, status === 'complete');
                    result = { result: `Marked ${text} as ${status}` };
                } else if (fc.name === 'getTodos') {
                    const list = currentTodosRef.current.map(t => t.text + (t.completed ? " (done)" : "")).join(", ");
                    result = { todos: list || "No items in list." };
                }

                // Send Tool Response
                if (sessionPromiseRef.current) {
                    sessionPromiseRef.current.then(session => {
                        session.sendToolResponse({
                            functionResponses: {
                                id: fc.id,
                                name: fc.name,
                                response: result
                            }
                        });
                    });
                }
              }
            }
            
            // Handle Interruption
            if (message.serverContent?.interrupted) {
                 sourcesRef.current.forEach(s => s.stop());
                 sourcesRef.current.clear();
                 nextStartTimeRef.current = 0;
                 setIsSpeaking(false);
            }
          },
          onclose: () => {
            setConnected(false);
            setIsSpeaking(false);
          },
          onerror: (err) => {
            console.error(err);
            setError("Connection error.");
            setConnected(false);
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
          },
          systemInstruction: "You are a high-energy, efficient personal assistant managing a todo list. Be concise. Use the provided tools to modify the list. If the user asks what is on the list, use the getTodos tool.",
          tools: [{ functionDeclarations: [addTodoFn, deleteTodoFn, markTodoFn, getTodosFn] }]
        }
      });

    } catch (e) {
      console.error(e);
      setError("Failed to start session.");
      setConnected(false);
    }
  }, [addTodo, deleteTodo, markTodo]);

  if (minimal) {
    return (
        <div className="flex items-center gap-2">
            {error && (
                <div className="absolute top-full right-0 mt-2 text-xs bg-red-500 text-white px-2 py-1 rounded shadow-lg z-50">
                    {error}
                </div>
            )}
            <button
                onClick={connected ? stopSession : startSession}
                className={`
                relative flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-200
                ${connected 
                    ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30' 
                    : 'bg-transparent text-slate-400 hover:text-primary-400 hover:bg-slate-800'
                }
                `}
                title={connected ? "Stop listening" : "Start voice agent"}
            >
                {/* Pulse animation when connected */}
                {connected && isSpeaking && (
                    <span className="absolute inset-0 rounded-lg bg-red-500/20 animate-ping"></span>
                )}
                
                {connected ? (
                <MicIcon className="w-5 h-5" />
                ) : (
                <MicOffIcon className="w-5 h-5" />
                )}
            </button>
            {connected && (
                <span className="text-xs font-medium text-red-400 animate-pulse hidden sm:inline-block">
                    {isSpeaking ? "Speaking..." : "Listening..."}
                </span>
            )}
        </div>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
       {error && (
        <div className="bg-red-500 text-white px-3 py-1 rounded-md text-sm mb-2 shadow-lg animate-pulse">
            {error}
        </div>
       )}
      
      <button
        onClick={connected ? stopSession : startSession}
        className={`
          relative flex items-center justify-center w-16 h-16 rounded-full shadow-2xl transition-all duration-300 transform hover:scale-105
          ${connected 
            ? 'bg-red-500 hover:bg-red-600 ring-4 ring-red-500/30' 
            : 'bg-primary-600 hover:bg-primary-500 ring-4 ring-primary-600/30'
          }
        `}
      >
         {/* Ripple Effect when connected */}
        {connected && (
           <span className={`absolute inset-0 rounded-full border-2 border-white opacity-50 ${isSpeaking ? 'animate-ping' : 'scale-100'}`}></span>
        )}

        {connected ? (
          <MicIcon className="w-8 h-8 text-white" />
        ) : (
          <MicOffIcon className="w-8 h-8 text-white" />
        )}
      </button>
      <div className="bg-slate-800 text-slate-200 text-xs py-1 px-2 rounded shadow-lg border border-slate-700">
         {connected ? (isSpeaking ? "Speaking..." : "Listening...") : "Tap to speak"}
      </div>
    </div>
  );
};