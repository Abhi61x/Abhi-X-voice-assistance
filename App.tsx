import React, { useState, useEffect, useRef, useCallback } from 'react';
import { handleTranscript, searchYouTube, fetchWeather } from './services/api';
import { AssistantAction, AssistantResponse, YouTubeSearchResult } from './types';

// Extend the Window interface for SpeechRecognition and YouTube Player API
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

type AssistantState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

/**
 * Parses simple, common commands locally to avoid unnecessary API calls.
 * @param transcript The user's voice transcript.
 * @returns An AssistantResponse object if a simple command is matched, otherwise null.
 */
const parseSimpleCommand = (transcript: string): AssistantResponse | null => {
    const normalizedTranscript = transcript.toLowerCase().trim();

    // Define patterns for simple commands (can include Hindi and English)
    const patterns: { action: AssistantAction; params?: any; replyText: string; regex: RegExp }[] = [
        {
            action: AssistantAction.Pause,
            replyText: "Playback rok diya gaya hai.",
            regex: /\b(pause|ruk|ruko|rok do)\b/i
        },
        {
            action: AssistantAction.Play,
            replyText: "Playback shuru kar raha hoon.",
            regex: /\b(play|chalao|shuru karo|resume)\b/i
        },
        {
            action: AssistantAction.Stop,
            replyText: "Playback band kar diya hai.",
            regex: /\b(stop|band karo)\b/i
        },
        {
            action: AssistantAction.Volume,
            params: { level: 'increase' },
            replyText: "Volume badha raha hoon.",
            regex: /volume.*(badhao|increase|up)|awaz.*(badhao|tez)/i
        },
        {
            action: AssistantAction.Volume,
            params: { level: 'decrease' },
            replyText: "Volume kam kar raha hoon.",
            regex: /volume.*(kam|decrease|down)|awaz.*(kam|dheere)/i
        },
    ];

    for (const pattern of patterns) {
        if (pattern.regex.test(normalizedTranscript)) {
            return {
                action: pattern.action,
                params: pattern.params || {},
                replyText: pattern.replyText,
            };
        }
    }

    return null; // No simple command matched
};

const StaticLogo = () => (
    <div className="w-full max-w-sm mb-4 animate-fade-in-up" style={{ animationDelay: '0.2s', filter: 'drop-shadow(0 0 15px rgba(0, 255, 255, 0.4))' }}>
        <svg viewBox="0 0 400 100" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto object-contain">
            <defs>
                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                    <feMerge>
                        <feMergeNode in="coloredBlur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
            </defs>
            <text
                x="50%"
                y="50%"
                dy=".35em"
                textAnchor="middle"
                fontFamily="Orbitron, sans-serif"
                fontSize="50"
                fill="#00ffff"
                filter="url(#glow)"
                letterSpacing="2"
                className="glowing-text"
            >
                Abhi - X
            </text>
        </svg>
    </div>
);


const App: React.FC = () => {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<string>('');
  const [assistantReply, setAssistantReply] = useState<string>('');
  const [assistantStatus, setAssistantStatus] = useState<string>('Idle');
  const [youtubeVideoId, setYoutubeVideoId] = useState<string | null>(null);
  const [youtubeVideoTitle, setYoutubeVideoTitle] = useState<string | null>(null);
  const [youtubeVideoThumbnailUrl, setYoutubeVideoThumbnailUrl] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<YouTubeSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(100);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  
  const recognitionRef = useRef<any>(null);
  const playerRef = useRef<any>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Effect to manage background animation state
  useEffect(() => {
    let state: AssistantState = 'idle';
    if (assistantStatus.toLowerCase().includes('error')) {
      state = 'error';
    } else if (isListening) {
      state = 'listening';
    } else if (isLoading || assistantStatus === 'Thinking...') {
      state = 'thinking';
    } else if (assistantStatus === 'Speaking...') {
      state = 'speaking';
    }
    document.body.dataset.assistantState = state;
  }, [isListening, isLoading, assistantStatus]);

  // Effect to create/destroy the YouTube player instance
  useEffect(() => {
    const createPlayer = (videoId: string) => {
      if (playerRef.current) {
        playerRef.current.destroy();
      }
      playerRef.current = new window.YT.Player('youtube-player-container', {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: {
          'autoplay': 1,
          'fs': 1,
          'playsinline': 1,
          'controls': 0,
          'rel': 0,
        },
        events: {
          'onReady': (event: any) => {
            event.target.setVolume(volume);
          },
          'onStateChange': (event: any) => {
            if (event.data === window.YT.PlayerState.PLAYING) {
              setIsPlaying(true);
            } else if (event.data === window.YT.PlayerState.PAUSED || event.data === window.YT.PlayerState.ENDED) {
              setIsPlaying(false);
            }
          }
        },
      });
    };

    window.onYouTubeIframeAPIReady = () => {
      if (youtubeVideoId) {
        createPlayer(youtubeVideoId);
      }
    };
    
    if (youtubeVideoId) {
      if (window.YT && window.YT.Player) {
        createPlayer(youtubeVideoId);
      }
    }
    
    return () => {
      if (playerRef.current && playerRef.current.destroy) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [youtubeVideoId, volume]);

  // Effect to sync local volume state with the YouTube player instance
  useEffect(() => {
    if (playerRef.current && typeof playerRef.current.setVolume === 'function') {
      playerRef.current.setVolume(volume);
    }
  }, [volume]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      if (!isLoading) {
        setAssistantStatus('Idle');
      }
    }
  }, [isLoading]);

 const speak = useCallback((text: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        const errorMsg = "Speech synthesis not supported in this browser.";
        console.error(errorMsg);
        setAssistantStatus('TTS Not Supported');
        reject(new Error(errorMsg));
        return;
      }
  
      if (!text.trim()) {
        console.warn("Speak function called with empty text.");
        if (!isListening && !isLoading) {
          setAssistantStatus('Idle');
        }
        resolve();
        return;
      }
  
      // Cancel any ongoing speech to prevent overlap
      window.speechSynthesis.cancel();
  
      setAssistantStatus('Speaking...');
  
      const utterance = new SpeechSynthesisUtterance(text);
      utteranceRef.current = utterance;
  
      // Find and set the Hindi voice for the assistant.
      const voices = window.speechSynthesis.getVoices();
      const hindiVoice = voices.find(voice => voice.lang === 'hi-IN');
      
      if (hindiVoice) {
        // If a Hindi voice is available on the system, use it.
        utterance.voice = hindiVoice;
      } else {
        // If the 'hi-IN' voice is not found, fall back to the browser's default voice.
        // A warning is logged to the console for debugging purposes.
        console.warn("Hindi (hi-IN) voice not found. Using default.");
      }
  
      utterance.onend = () => {
        if (!isListening && !isLoading) {
          setAssistantStatus('Idle');
        }
        utteranceRef.current = null;
        resolve();
      };
  
      utterance.onerror = (event) => {
        console.error("Speech synthesis error:", event);
        setAssistantStatus('TTS Error');
        utteranceRef.current = null;
        reject(event);
      };
  
      // Start the speech synthesis
      window.speechSynthesis.speak(utterance);
    });
  }, [isListening, isLoading]);

  const handleStopPlayback = useCallback(() => {
    if (playerRef.current?.stopVideo) {
        playerRef.current.stopVideo();
    }
    setYoutubeVideoId(null);
    setYoutubeVideoTitle(null);
    setYoutubeVideoThumbnailUrl(null);
    setSearchResults([]);
    setIsPlaying(false);
    setAssistantStatus('Playback stopped');
  }, []);


  const handleAssistantAction = useCallback(async (response: AssistantResponse) => {
      switch (response.action) {
        case AssistantAction.SearchYouTube: {
            if (response.params.query) {
                setAssistantStatus(`Searching YouTube for "${response.params.query}"...`);
                setYoutubeVideoId(null); // Clear player
                const results = await searchYouTube(response.params.query);
                setSearchResults(results);
                if (results.length === 0) {
                    const notFoundMsg = `I couldn't find any videos for "${response.params.query}".`;
                    setAssistantReply(notFoundMsg);
                    await speak(notFoundMsg);
                }
            }
            break;
        }
        case AssistantAction.PlayVideo:
        case AssistantAction.PlayMusic:
          if (response.params.query) {
              setAssistantStatus(`Searching for ${response.params.query}...`);
              const results = await searchYouTube(response.params.query);
              if (results.length > 0) {
                  const firstVideo = results[0];
                  setYoutubeVideoId(firstVideo.videoId);
                  setYoutubeVideoTitle(firstVideo.title);
                  setYoutubeVideoThumbnailUrl(firstVideo.thumbnailUrl);
                  setSearchResults([]); // Clear search results when playing directly
              } else {
                  const notFoundMsg = `I couldn't find a video for "${response.params.query}".`;
                  setAssistantReply(notFoundMsg);
                  await speak(notFoundMsg);
              }
          }
          break;
        case AssistantAction.Play:
            if (playerRef.current?.playVideo) {
                playerRef.current.playVideo();
                setAssistantStatus('Playback resumed');
            }
            break;
        case AssistantAction.Pause:
            if (playerRef.current?.pauseVideo) {
                playerRef.current.pauseVideo();
                setAssistantStatus('Playback paused');
            }
            break;
        case AssistantAction.Stop:
            handleStopPlayback();
            break;
        case AssistantAction.Volume: {
            if (!playerRef.current?.setVolume) {
                const noVideoMsg = 'No active video to adjust volume.';
                setAssistantReply(noVideoMsg);
                await speak(noVideoMsg);
                break;
            }
            
            let newVolume = volume;
            const level = response.params.level; // Can be "increase", "decrease", a number, or a string of a number.

            if (level === 'increase') {
                newVolume = Math.min(volume + 10, 100);
            } else if (level === 'decrease') {
                newVolume = Math.max(volume - 10, 0);
            } else if (level !== undefined) {
                const parsedLevel = parseInt(String(level), 10);
                if (!isNaN(parsedLevel)) {
                    newVolume = Math.max(0, Math.min(100, parsedLevel));
                }
            }
            
            setVolume(newVolume);
            setAssistantStatus(`Volume set to ${newVolume}%`);
            break;
        }
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
            const { weatherReport } = await fetchWeather(location);
            setAssistantReply(weatherReport);
            await speak(weatherReport);
            break;
        }
        case AssistantAction.SetTimer:
            if (response.params.duration) {
                const { duration } = response.params; // in seconds

                // Calculate expiration time
                const expirationTime = new Date(Date.now() + duration * 1000);
                const formattedExpirationTime = expirationTime.toLocaleString('en-US', {
                    hour: 'numeric',
                    minute: 'numeric',
                    hour12: true
                });

                // Format duration text
                const minutes = Math.floor(duration / 60);
                const seconds = duration % 60;
                let durationText = '';
                if (minutes > 0) durationText += `${minutes} minute${minutes > 1 ? 's' : ''} `;
                if (seconds > 0) durationText += `${seconds} second${seconds > 1 ? 's' : ''}`;
                durationText = durationText.trim();

                // Construct new confirmation message
                const confirmationMessage = `${durationText} ke liye timer set kar diya gaya hai. Timer ${formattedExpirationTime} par samapt hoga.`;
                
                setAssistantStatus(confirmationMessage);
                setAssistantReply(confirmationMessage); // Update display text

                // Speak the confirmation and start the timer
                await speak(confirmationMessage);
                
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
            // Reply action is handled by speaking the initial replyText in processCommand.
            break;
      }
  }, [stopListening, volume, speak, handleStopPlayback]);

  const processCommand = useCallback(async (text: string) => {
    if (!text || isLoading) return;

    setIsLoading(true);
    setAssistantStatus('Thinking...');
    setTranscript(text);

    // First, try to parse a simple, local command to avoid an API call
    const simpleResponse = parseSimpleCommand(text);

    if (simpleResponse) {
        setAssistantReply(simpleResponse.replyText);
        try {
            await speak(simpleResponse.replyText);
            await handleAssistantAction(simpleResponse);
        } catch (error: any) {
            console.error("Error processing simple command:", error);
            const errorMessage = "Ek anjaan samasya aa gayi hai.";
            setAssistantReply(errorMessage);
            setAssistantStatus('Error');
            await speak(errorMessage).catch(e => console.error("TTS failed on simple command error", e));
        } finally {
            setIsLoading(false);
            setTranscript('');
             if (!window.speechSynthesis.speaking) {
                setAssistantStatus('Idle');
            }
        }
        return; // End execution here for simple commands
    }

    // If not a simple command, proceed with the Gemini API call
    try {
      const response = await handleTranscript(text);
      setAssistantReply(response.replyText || '');
      
      // Speak the initial confirmation reply from the AI if it exists.
      if (response.replyText) {
        await speak(response.replyText);
      }
      
      // Perform the core action. Some actions might speak again with results.
      await handleAssistantAction(response);
      
    } catch (error: any) {
      console.error("Error processing command:", error);
      const errorMessage = error.message || 'Ek anjaan samasya aa gayi hai. Kripya punah prayas karein.';
      setAssistantReply(errorMessage);
      setAssistantStatus('Error');
      try {
        await speak(errorMessage);
      } catch (ttsError) {
        console.error("TTS failed during error handling:", ttsError);
        // If TTS fails, the user can still read the error message on screen.
      }
    } finally {
      setIsLoading(false);
      setTranscript('');
      // Set status to Idle only if no other process (like speaking) is active
      if (!window.speechSynthesis.speaking) {
        setAssistantStatus('Idle');
      }
    }
  }, [isLoading, handleAssistantAction, speak]);
  
  
  const startListening = () => {
    if (recognitionRef.current && !isListening) {
      setIsListening(true);
      setAssistantStatus('Listening...');
      setYoutubeVideoId(null);
      setYoutubeVideoTitle(null);
      setYoutubeVideoThumbnailUrl(null);
      setSearchResults([]);
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
      let errorMessage = '';
      let statusMessage = 'Error';

      switch(event.error) {
          case 'no-speech':
            setAssistantStatus('Idle');
            stopListening();
            return;
          case 'audio-capture':
            errorMessage = 'Aapke microphone ka access nahi mil raha hai. Kripya permissions jaanchein.';
            statusMessage = 'Microphone Error';
            break;
          case 'network':
            errorMessage = 'Voice commands ke liye network anivarya hai. Kripya apna internet jaanchein.';
            statusMessage = 'Network Error';
            break;
          case 'not-allowed':
          case 'service-not-allowed':
            errorMessage = 'Voice recognition anumati nahi hai. Kripya browser settings mein isse saksham karein.';
            statusMessage = 'Permission Denied';
            break;
          default:
            errorMessage = 'Voice recognition me ek anjaan samasya aa gayi hai.';
            break;
      }
      
      setAssistantReply(errorMessage);
      setAssistantStatus(statusMessage);
      
      // Speak the error message
      if (errorMessage) {
        speak(errorMessage);
      }

      stopListening();
    };

    recognitionRef.current = recognition;

  }, [processCommand, stopListening, speak]);

  const getStatusColor = () => {
    if (isLoading || assistantStatus === 'Thinking...') return 'border-yellow-400';
    if (isListening) return 'border-red-500';
    if (assistantStatus === 'Speaking...') return 'border-green-400';
    if (assistantStatus.toLowerCase().includes('error')) return 'border-red-600';
    return 'border-cyan-400';
  };

  const handleVideoSelect = (video: YouTubeSearchResult) => {
    setYoutubeVideoId(video.videoId);
    setYoutubeVideoTitle(video.title);
    setYoutubeVideoThumbnailUrl(video.thumbnailUrl);
    setSearchResults([]); // Hide results after selection
  };
  
  const handlePlayPause = () => {
    if (!playerRef.current) return;
    if (isPlaying) {
      playerRef.current.pauseVideo();
    } else {
      playerRef.current.playVideo();
    }
  };

  return (
    <main className="text-white min-h-screen flex flex-col items-center justify-center p-4 selection:bg-cyan-300 selection:text-cyan-900 relative z-10">

        <div className="w-full max-w-5xl flex flex-col items-center justify-center gap-8">

            {!youtubeVideoId && searchResults.length === 0 && <StaticLogo />}

            {youtubeVideoId && (
                <div className="w-full flex flex-col md:flex-row items-start gap-6 animate-fade-in-up">
                    
                    <div className="w-full md:w-2/3 aspect-video rounded-lg overflow-hidden glowing-border flex-shrink-0">
                        <div id="youtube-player-container" className="w-full h-full"></div>
                    </div>

                    <div className="w-full md:w-1/3 flex flex-col gap-4 p-4 rounded-lg bg-cyan-900/20 glowing-border backdrop-blur-sm">
                        {youtubeVideoThumbnailUrl && (
                            <img 
                                src={youtubeVideoThumbnailUrl} 
                                alt="Video thumbnail" 
                                className="w-full h-auto rounded-md object-cover" 
                            />
                        )}
                        {youtubeVideoTitle && (
                            <p className="text-cyan-200 text-lg font-semibold glowing-text">
                                {youtubeVideoTitle}
                            </p>
                        )}

                        <div className="w-full flex items-center gap-3 pt-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-cyan-300 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                            </svg>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={volume}
                                onChange={(e) => setVolume(Number(e.target.value))}
                                className="w-full h-2 bg-cyan-900/50 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                                aria-label="Volume control"
                            />
                            <span className="w-16 text-center glowing-text font-mono">{volume}%</span>
                        </div>
                        
                        <div className="w-full flex items-center justify-center gap-4 pt-4">
                            <button onClick={handlePlayPause} className="p-4 bg-cyan-900/50 rounded-full glowing-border transition-all duration-300 hover:bg-cyan-700/70 hover:scale-110 active:scale-95" aria-label={isPlaying ? "Pause video" : "Play video"}>
                                {isPlaying ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-cyan-300" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-cyan-300" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>

                                )}
                            </button>
                            <button onClick={handleStopPlayback} className="p-4 bg-cyan-900/50 rounded-full glowing-border transition-all duration-300 hover:bg-cyan-700/70 hover:scale-110 active:scale-95" aria-label="Stop video">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-cyan-300" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {searchResults.length > 0 && (
              <div className="w-full">
                <h2 className="text-2xl text-center font-bold glowing-text mb-6 animate-fade-in-up">Search Results</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {searchResults.map((video, index) => (
                    <div 
                      key={video.videoId} 
                      onClick={() => handleVideoSelect(video)}
                      className="group cursor-pointer bg-cyan-900/20 rounded-lg overflow-hidden glowing-border transition-all duration-300 hover:scale-105 hover:shadow-cyan-400/30 hover:shadow-2xl active:scale-100 animate-fade-in-up"
                      style={{ animationDelay: `${index * 100}ms` }}
                      role="button"
                      aria-label={`Play video: ${video.title}`}
                    >
                      <img src={video.thumbnailUrl} alt={video.title} className="w-full h-32 object-cover" />
                      <div className="p-3">
                        <p className="text-cyan-200 text-sm font-semibold glowing-text line-clamp-2" title={video.title}>
                          {video.title}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Main Control UI - Conditionally render based on whether there's a video or search results */}
            {!youtubeVideoId && searchResults.length === 0 && (
                <div 
                    onClick={isListening ? stopListening : startListening}
                    className="relative w-64 h-64 md:w-80 md:h-80 flex items-center justify-center cursor-pointer group animate-fade-in-up"
                    role="button"
                    aria-label={isListening ? 'Stop listening' : 'Start listening'}
                >
                    {/* Outer Ring 1 */}
                    <div className={`absolute inset-0 rounded-full border-4 ${getStatusColor()} transition-colors duration-500 ${
                        isLoading || assistantStatus === 'Thinking...' 
                        ? 'animate-spin-slow' 
                        : (isListening || assistantStatus === 'Speaking...' || assistantStatus.toLowerCase().includes('error')) 
                        ? 'animate-pulse' 
                        : 'animate-pulse-slow'
                    }`}></div>
                    
                    {/* Outer Ring 2 */}
                    <div className={`absolute inset-4 rounded-full border-2 ${getStatusColor()} opacity-60 transition-colors duration-500 ${
                        isLoading || assistantStatus === 'Thinking...' 
                        ? 'animate-spin-reverse' 
                        : (isListening || assistantStatus === 'Speaking...' || assistantStatus.toLowerCase().includes('error')) 
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
                                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2h2v2a5 5 0 0010 0v-2h2z" />
                            </svg>
                        </div>
                    </div>
                </div>
            )}

            <div className="w-full max-w-2xl text-center h-20 flex flex-col justify-center items-center animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
                <p className="text-2xl font-bold glowing-text mb-2 transition-opacity duration-300 min-h-[32px]">
                    {transcript}
                </p>
                <p className="text-xl text-cyan-200 transition-opacity duration-300 min-h-[28px]">
                    {assistantReply || assistantStatus}
                </p>
            </div>
        </div>
    </main>
  );
};

export default App;