import React, { useState, useRef } from 'react';
import { MicIcon, MicOffIcon } from './Icons';
import { transcribeAudio } from '../services/geminiService';

interface VoiceDictationProps {
  onTranscript: (text: string) => void;
}

export const VoiceDictation: React.FC<VoiceDictationProps> = ({ onTranscript }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setIsProcessing(true);
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        
        // Convert Blob to Base64
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64data = reader.result as string;
          // Extract just the base64 part, removing data:audio/webm;base64,
          const base64Content = base64data.split(',')[1];
          const mimeType = base64data.split(',')[0].match(/:(.*?);/)?.[1] || 'audio/webm';

          const text = await transcribeAudio(base64Content, mimeType);
          if (text) {
            onTranscript(text);
          }
          setIsProcessing(false);
        };
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setIsProcessing(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={isRecording ? stopRecording : startRecording}
        disabled={isProcessing}
        className={`
          relative flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-200
          ${isRecording 
            ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30' 
            : 'bg-transparent text-slate-400 hover:text-primary-400 hover:bg-slate-800'
          }
          ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        title={isRecording ? "Stop Dictation" : "Dictate Task"}
      >
        {isRecording && (
             <span className="absolute inset-0 rounded-lg bg-red-500/20 animate-ping"></span>
        )}
        
        {isProcessing ? (
            <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
        ) : isRecording ? (
            <MicIcon className="w-5 h-5" />
        ) : (
            <MicOffIcon className="w-5 h-5" />
        )}
      </button>
    </div>
  );
};