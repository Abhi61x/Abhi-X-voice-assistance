import React, { useState, useEffect, useRef, useCallback } from 'react';
import { handleTranscript, searchYouTube, textToSpeech, fetchWeather } from './services/api';
import { AssistantAction, AssistantResponse } from './types';

// Extend the Window interface for SpeechRecognition
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const App: React.FC = () => {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<string>('');
  const [assistantReply, setAssistantReply] = useState<string>('');
  const [assistantStatus, setAssistantStatus] = useState<string>('Idle');
  const [youtubeVideoId, setYoutubeVideoId] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [sourceLinks, setSourceLinks] = useState<any[]>([]);
  
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      if (!isLoading) {
        setAssistantStatus('Idle');
      }
    }
  }, [isLoading]);

  const handleAssistantAction = useCallback(async (response: AssistantResponse) => {
      switch (response.action) {
        case AssistantAction.SearchYouTube:
        case AssistantAction.PlayVideo:
        case AssistantAction.PlayMusic:
          if (response.params.query) {
              setAssistantStatus(`Searching for ${response.params.query}...`);
              const { videoId, groundingChunks } = await searchYouTube(response.params.query);
              if (groundingChunks) {
                setSourceLinks(groundingChunks.filter((c: any) => c.web).map((c: any) => c.web));
              }
              if (videoId) {
                  setYoutubeVideoId(videoId);
              } else {
                  const notFoundMsg = `I couldn't find a video for "${response.params.query}".`;
                  setAssistantReply(notFoundMsg);
                  const ttsUrl = await textToSpeech(notFoundMsg);
                  setAudioUrl(ttsUrl);
              }
          }
          break;
        case AssistantAction.Pause:
            setAssistantStatus('Pausing...');
            // In a real app, you'd use the YouTube Iframe API to pause the video.
            break;
        case AssistantAction.Stop:
            setAssistantStatus('Stopping video...');
            setYoutubeVideoId(null);
            break;
        case AssistantAction.Volume:
            setAssistantStatus('Adjusting volume...');
            // In a real app, you'd use the YouTube Iframe API to adjust volume.
            break;
        case AssistantAction.OpenUrl:
            if(response.params.url) {
                let url = response.params.url;
                setAssistantStatus(`Opening ${url}...`);
                if (!/^https?:\/\//i.test(url)) {
                    url = 'https://' + url;
                }
                window.open(url, '_blank');
            }
            break;
        case AssistantAction.GetWeather: {
            const location = response.params.location || 'New Delhi'; // Default to New Delhi if not specified
            setAssistantStatus(`Checking the weather in ${location}...`);
            const weatherReport = await fetchWeather(location);
            setAssistantReply(weatherReport);
            const ttsUrl = await textToSpeech(weatherReport);
            setAudioUrl(ttsUrl);
            break;
        }
        case AssistantAction.SetTimer:
            if (response.params.duration) {
                const { duration } = response.params;
                const minutes = Math.floor(duration / 60);
                const seconds = duration % 60;
                let durationText = '';
                if (minutes > 0) durationText += `${minutes} minute${minutes > 1 ? 's' : ''} `;
                if (seconds > 0) durationText += `${seconds} second${seconds > 1 ? 's' : ''}`;
                
                setAssistantStatus(`Setting timer for ${durationText.trim()}...`);
                setTimeout(() => {
                    alert("Time's up!");
                }, duration * 1000);
            }
            break;
        case AssistantAction.OpenApp:
             if (response.params.appName) {
                setAssistantStatus(`Opening ${response.params.appName}...`);
             }
            break;
        case AssistantAction.StopListening:
            setAssistantStatus('Deactivating...');
            stopListening();
            break;
        case AssistantAction.Reply:
        default:
            // Reply action is handled by setting assistantReply and playing TTS
            break;
      }
  }, [stopListening]);

  const processCommand = useCallback(async (text: string) => {
    if (!text || isLoading) return;

    setIsLoading(true);
    setAssistantStatus('Thinking...');
    setTranscript(text);

    try {
      const response = await handleTranscript(text);
      setAssistantReply(response.replyText || '');
      
      await handleAssistantAction(response);

      if (response.replyText && response.action !== AssistantAction.GetWeather) {
        const ttsUrl = await textToSpeech(response.replyText);
        setAudioUrl(ttsUrl);
      }
      
    } catch (error) {
      console.error(error);
      const errorMessage = 'Sorry, I had trouble understanding. Please try again.';
      setAssistantReply(errorMessage);
      const ttsUrl = await textToSpeech(errorMessage);
      setAudioUrl(ttsUrl);
    } finally {
      setIsLoading(false);
      setTranscript('');
    }
  }, [isLoading, handleAssistantAction]);
  
  
  const startListening = () => {
    if (recognitionRef.current && !isListening) {
      setIsListening(true);
      setAssistantStatus('Listening...');
      setYoutubeVideoId(null);
      setSourceLinks([]);
      setTranscript('');
      setAssistantReply('');
      recognitionRef.current.start();
    }
  };
  
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error("Speech Recognition API not supported in this browser.");
      setAssistantStatus("Speech recognition not supported.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'hi-IN';

    recognition.onresult = (event: any) => {
        let finalTranscript = '';
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }
        setTranscript(finalTranscript || interimTranscript);
        if (finalTranscript) {
            processCommand(finalTranscript.trim());
        }
    };
    
    recognition.onend = () => {
      stopListening();
    };
    
    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      if (event.error === 'no-speech') {
        setAssistantStatus('Idle');
      } else {
        setAssistantStatus('Error');
      }
      stopListening();
    };

    recognitionRef.current = recognition;

  }, [processCommand, stopListening]);
  
  useEffect(() => {
    if (audioUrl && audioRef.current) {
      audioRef.current.src = audioUrl;
      setAssistantStatus('Speaking...');
      audioRef.current.play().catch(e => console.error("Audio playback failed", e));
      
      const handleAudioEnd = () => {
        if (!isListening && !isLoading) {
            setAssistantStatus('Idle');
        }
        URL.revokeObjectURL(audioUrl);
        setAudioUrl(null);
      };

      const currentAudioRef = audioRef.current;
      currentAudioRef.addEventListener('ended', handleAudioEnd);

      return () => {
        currentAudioRef?.removeEventListener('ended', handleAudioEnd);
      }
    }
  }, [audioUrl, isListening, isLoading]);

  const getStatusColor = () => {
    if (isLoading || assistantStatus === 'Thinking...') return 'border-yellow-400';
    if (isListening) return 'border-red-500';
    if (assistantStatus === 'Speaking...') return 'border-green-400';
    return 'border-cyan-400';
  };

  return (
    <main className="bg-[#0a0a1a] text-white min-h-screen flex flex-col items-center justify-center p-4 selection:bg-cyan-300 selection:text-cyan-900">
        <div className="w-full max-w-4xl flex flex-col items-center gap-8">

        {youtubeVideoId && (
            <div className="w-full aspect-video rounded-lg overflow-hidden glowing-border">
            <iframe
                width="100%"
                height="100%"
                src={`https://www.youtube.com/embed/${youtubeVideoId}?autoplay=1&fs=1`}
                title="YouTube video player"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
            ></iframe>
            </div>
        )}

        <div 
            onClick={isListening ? stopListening : startListening}
            className="relative w-64 h-64 md:w-80 md:h-80 flex items-center justify-center cursor-pointer group"
            role="button"
            aria-label={isListening ? 'Stop listening' : 'Start listening'}
        >
            {/* Outer Ring 1 */}
            <div className={`absolute inset-0 rounded-full border-4 ${getStatusColor()} transition-colors duration-500 ${
                isLoading || assistantStatus === 'Thinking...' 
                ? 'animate-spin-slow' 
                : (isListening || assistantStatus === 'Speaking...') 
                ? 'animate-pulse' 
                : 'animate-pulse-slow'
            }`}></div>
            
            {/* Outer Ring 2 */}
            <div className={`absolute inset-4 rounded-full border-2 ${getStatusColor()} opacity-60 transition-colors duration-500 ${
                isLoading || assistantStatus === 'Thinking...' 
                ? 'animate-spin-reverse' 
                : (isListening || assistantStatus === 'Speaking...') 
                ? 'animate-pulse' 
                : 'animate-pulse-slow'
            }`} style={{animationDelay: (isLoading || assistantStatus === 'Thinking...') ? '0s' : '0.2s'}}></div>

            {/* Avatar Core */}
            <div className={`z-10 w-40 h-40 md:w-48 md:h-48 rounded-full flex items-center justify-center bg-cyan-900/50 glowing-border backdrop-blur-sm transition-all duration-300 group-hover:scale-105 group-active:scale-95 animate-float-subtle`}>
                {/* Inner Glowing Orb */}
                <div className={`w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center bg-gradient-to-br from-cyan-500/30 to-blue-800/40 relative shadow-inner shadow-cyan-900/50 transition-all duration-300 ${
                    isListening ? 'animate-pulse' : (isLoading || assistantStatus === 'Thinking...') ? 'animate-pulse-slow' : ''
                }`}>
                     {/* Microphone Icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" className={`h-16 w-16 md:h-20 md:w-20 transition-all duration-300 ${isListening ? 'text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.8)] animate-pulse' : 'text-cyan-300 drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]'}`} viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"/>
                    </svg>
                </div>
            </div>
        </div>

        <div className="w-full text-center h-24 flex flex-col justify-center items-center">
            <p key={assistantStatus} className="text-2xl md:text-3xl glowing-text font-bold mb-2 capitalize animate-fade-in-up">{assistantStatus}</p>
            <p className="text-lg md:text-xl text-gray-400 min-h-[2rem] px-4">
                {transcript || assistantReply}
            </p>
        </div>
        
        {sourceLinks.length > 0 && (
          <div className="w-full max-w-2xl text-center">
            <p className="text-gray-400 text-sm">Sources:</p>
            <ul className="text-xs text-cyan-400/80 flex flex-wrap justify-center gap-x-4">
              {sourceLinks.map((link, index) => (
                <li key={index}>
                  <a href={link.uri} target="_blank" rel="noopener noreferrer" className="hover:underline" title={link.uri}>{link.title || new URL(link.uri).hostname}</a>
                </li>
              ))}
            </ul>
          </div>
        )}
        
        <audio ref={audioRef} hidden />

        </div>
        <footer className="absolute bottom-4 text-center text-gray-500 text-sm">
            <p>Created by Abhishek</p>
        </footer>
    </main>
  );
};

export default App;