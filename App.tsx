import React, { useState, useEffect, useRef, useCallback } from 'react';
import { handleTranscript, searchYouTube, fetchWeather, performWebSearch, generateTextForFile, generateSpeech } from './services/api';
import { AssistantAction, AssistantResponse, YouTubeSearchResult, WebSearchResult, Reminder } from './types';

// Extend the Window interface for SpeechRecognition, YouTube Player API, and File System Access API
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
    YT: any;
    onYouTubeIframeAPIReady: () => void;
    showOpenFilePicker: (options?: any) => Promise<[FileSystemFileHandle]>;
    hljs: any;
  }
  interface FileSystemFileHandle {
    getFile: () => Promise<File>;
    createWritable: (options?: FileSystemCreateWritableOptions) => Promise<FileSystemWritableFileStream>;
  }
  // This interface is part of the File System Access API standard.
  interface FileSystemCreateWritableOptions {
    keepExistingData?: boolean;
  }
}

type AssistantState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
type ActivePanel = 'youtube' | 'code' | 'notes' | 'youtubeSearchResults' | 'webSearchResults' | 'file' | 'none';

const ELEVENLABS_VOICES = [
  { id: '5g2Q0t622soF22T5iT2D', name: 'Priya (Female)' },
  { id: 'sP1YJ01Yf75LNLsoi82f', name: 'Suhani (Female)' },
  { id: '8s19451gcbE8Qj2tEen4', name: 'Aarav (Male)' },
];
const DEFAULT_VOICE = `elevenlabs:${ELEVENLABS_VOICES[0].id}`;

const App: React.FC = () => {
  const [assistantState, setAssistantState] = useState<AssistantState>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [assistantReply, setAssistantReply] = useState<string>('');
  const [assistantStatusText, setAssistantStatusText] = useState<string>('Activate Assistant');
  
  // Panel States
  const [targetPanel, setTargetPanel] = useState<ActivePanel>('none');
  const [renderedPanel, setRenderedPanel] = useState<ActivePanel>('none');
  const [isExiting, setIsExiting] = useState(false);

  // Content States
  const [youtubeVideoId, setYoutubeVideoId] = useState<string | null>(null);
  const [youtubeVideoTitle, setYoutubeVideoTitle] = useState<string | null>(null);
  const [youtubeSearchResults, setYoutubeSearchResults] = useState<YouTubeSearchResult[]>([]);
  const [webSearchResults, setWebSearchResults] = useState<WebSearchResult[]>([]);
  const [currentVideoIndex, setCurrentVideoIndex] = useState<number | null>(null);
  const [codeSnippet, setCodeSnippet] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  
  // File Editor States
  const [detectedLanguage, setDetectedLanguage] = useState<string>('plaintext');
  const [findQuery, setFindQuery] = useState<string>('');
  const [replaceQuery, setReplaceQuery] = useState<string>('');
  const [lineNumbers, setLineNumbers] = useState('1');

  // Control & Settings States
  const [volume, setVolume] = useState<number>(100);
  const [brightness, setBrightness] = useState<number>(100);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isOnCooldown, setIsOnCooldown] = useState<boolean>(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [browserHindiVoices, setBrowserHindiVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [selectedVoice, setSelectedVoice] = useState<string>(DEFAULT_VOICE);

  
  // Refs
  const recognitionRef = useRef<any>(null);
  const recognitionActive = useRef(false);
  const assistantStateRef = useRef(assistantState);
  const playerRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const visualizerCanvasRef = useRef<HTMLCanvasElement>(null);
  const fullTranscriptRef = useRef<string>('');
  const panelTimeoutRef = useRef<number | null>(null);
  const codeBlockRef = useRef<HTMLElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const lineNumbersRef = useRef<HTMLPreElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isSourceBufferUpdatingRef = useRef(false);
  const playbackEndFiredRef = useRef(false);
  const debounceTimeoutRef = useRef<number | null>(null);


  useEffect(() => {
    document.body.dataset.assistantState = assistantState;
    assistantStateRef.current = assistantState;
  }, [assistantState]);
  
  useEffect(() => {
    try {
        const savedNotes = localStorage.getItem('kaniska-notes');
        if (savedNotes) setNotes(JSON.parse(savedNotes));
        
        const savedVoice = localStorage.getItem('kaniska-selected-voice');
        if (savedVoice) setSelectedVoice(savedVoice);

    } catch (error) {
        console.error("Failed to load from localStorage", error);
    }
  }, []);

  useEffect(() => {
    try {
        localStorage.setItem('kaniska-notes', JSON.stringify(notes));
    } catch (error) {
        console.error("Failed to save notes to localStorage", error);
    }
  }, [notes]);

  useEffect(() => {
    try {
        localStorage.setItem('kaniska-selected-voice', selectedVoice);
    } catch (error) {
        console.error("Failed to save voice to localStorage", error);
    }
  }, [selectedVoice]);

  useEffect(() => {
    if ('speechSynthesis' in window) {
        const updateVoices = () => {
            const allVoices = window.speechSynthesis.getVoices();
            setVoices(allVoices);
            setBrowserHindiVoices(allVoices.filter(v => v.lang === 'hi-IN'));
        };
        window.speechSynthesis.onvoiceschanged = updateVoices;
        updateVoices();
    }
  }, []);

  // Panel Animation Effect
  useEffect(() => {
    if (targetPanel !== renderedPanel) {
      if (renderedPanel !== 'none') {
        setIsExiting(true); 
        const timeoutId = window.setTimeout(() => {
          setRenderedPanel(targetPanel); 
          setIsExiting(false); 
          panelTimeoutRef.current = null; 
        }, 500);
        panelTimeoutRef.current = timeoutId;
      } else {
        setRenderedPanel(targetPanel);
      }
    }
    return () => {
      if (panelTimeoutRef.current) {
        window.clearTimeout(panelTimeoutRef.current);
      }
    };
  }, [targetPanel, renderedPanel]);

  // Audio Visualizer Setup
  const setupAudioVisualizer = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn('getUserMedia not supported on this browser!');
      return;
    }
    if (!audioContextRef.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const context = new AudioContext();
        audioContextRef.current = context;
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;
        drawVisualizer();
      } catch (err) {
        console.error('Error setting up audio visualizer:', err);
      }
    }
  }, []);

  const drawVisualizer = () => {
    requestAnimationFrame(drawVisualizer);
    const canvas = visualizerCanvasRef.current;
    if (!analyserRef.current || !canvas || assistantStateRef.current !== 'listening') {
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    };
    
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.current.getByteFrequencyData(dataArray);

    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = 68; // Inner radius of the arc reactor core

    ctx.clearRect(0, 0, width, height);
    
    const gradient = ctx.createRadialGradient(centerX, centerY, radius - 20, centerX, centerY, radius + 40);
    gradient.addColorStop(0, 'rgba(0, 234, 255, 0)');
    gradient.addColorStop(0.5, 'rgba(0, 234, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(0, 140, 255, 0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + 40, 0, 2 * Math.PI);
    ctx.fill();

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = `rgba(208, 250, 255, 0.9)`;
    ctx.beginPath();
    
    const sliceWidth = (Math.PI * 2) / bufferLength;
    for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const amp = v * 25;
        
        const angle = i * sliceWidth;
        const startR = radius - (amp / 2);
        const endR = radius + (amp / 2);

        const x1 = centerX + startR * Math.cos(angle);
        const y1 = centerY + startR * Math.sin(angle);
        const x2 = centerX + endR * Math.cos(angle);
        const y2 = centerY + endR * Math.sin(angle);
        
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  };
    
  useEffect(() => {
    if (playerRef.current && typeof playerRef.current.setVolume === 'function') {
        playerRef.current.setVolume(volume);
    }
  }, [volume]);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis.cancel();
    if (audioRef.current) {
        audioRef.current.pause();
        if (mediaSourceRef.current && mediaSourceRef.current.readyState === 'open') {
            try { mediaSourceRef.current.endOfStream(); } 
            catch (e) { console.warn("Error ending media source stream:", e); }
        }
        audioRef.current.src = '';
        mediaSourceRef.current = null;
        sourceBufferRef.current = null;
        audioQueueRef.current = [];
        isSourceBufferUpdatingRef.current = false;
    }
  }, []);

  const startListening = useCallback(() => {
    if (recognitionActive.current || isOnCooldown || assistantStateRef.current === 'thinking' || assistantStateRef.current === 'speaking') {
        console.warn(`startListening blocked. Active: ${recognitionActive.current}, Cooldown: ${isOnCooldown}, State: ${assistantStateRef.current}`);
        return;
    }
    
    setAssistantState('listening');
    setAssistantStatusText('Listening...');
    setTranscript('');
    fullTranscriptRef.current = '';
    setAssistantReply('');
    stopSpeaking();
    setupAudioVisualizer();
    try {
        recognitionRef.current?.start();
    } catch (e) {
        console.error("Recognition start failed:", e);
        recognitionActive.current = false; // Defensive reset
        setAssistantState('error');
        setAssistantStatusText('Mic Error');
    }
  }, [isOnCooldown, stopSpeaking, setupAudioVisualizer]);

  const useBrowserTTS = useCallback((text: string, onEnd: () => void, voiceName?: string) => {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);

        let selectedVoiceInstance: SpeechSynthesisVoice | undefined;
        if (voiceName) {
            selectedVoiceInstance = voices.find(v => v.name === voiceName);
        }
        if (!selectedVoiceInstance) {
            selectedVoiceInstance = voices.find(v => v.lang === 'hi-IN') || voices.find(v => v.lang.startsWith('hi'));
        }
        
        if (selectedVoiceInstance) {
            utterance.voice = selectedVoiceInstance;
        } else {
            console.warn("No Hindi voice found for browser TTS.");
        }
        
        let hasEnded = false;
        const onEndOnce = () => {
            if (hasEnded) return;
            hasEnded = true;
            onEnd();
        };

        utterance.onend = onEndOnce;
        utterance.onerror = (e: SpeechSynthesisErrorEvent) => {
            console.error('Browser SpeechSynthesis error:', e.error);
            onEndOnce();
        };
        window.speechSynthesis.speak(utterance);
    } else {
        onEnd(); // If no TTS, just call the callback
    }
  }, [voices]);

  const speak = useCallback(async (text: string, onEndCallback: () => void = () => {}) => {
    // Clean the text to remove symbols that shouldn't be spoken
    const cleanedText = text.replace(/[^\p{L}\p{N}\s.,?!।]/gu, ' ').replace(/\s+/g, ' ').trim();

    if (!cleanedText) {
        console.warn("Skipping speech for empty or symbol-only text.");
        onEndCallback();
        return;
    }

    setAssistantState('speaking');
    setAssistantStatusText('...'); // Speaking indicator
    setAssistantReply(cleanedText);
    stopSpeaking(); // Cancel any previous speech

    const useElevenLabs = selectedVoice.startsWith('elevenlabs:');
    
    const handleEnd = () => {
        setAssistantState('idle'); // Set to idle before callback
        onEndCallback();
    };

    if (useElevenLabs && process.env.ELEVENLABS_API_KEY) {
        const voiceId = selectedVoice.split(':')[1];
        try {
            const stream = await generateSpeech(cleanedText, voiceId);
            if (stream) {
                const audio = audioRef.current;
                if (!audio) {
                    useBrowserTTS(cleanedText, handleEnd, selectedVoice);
                    return;
                }
                const mediaSource = new MediaSource();
                mediaSourceRef.current = mediaSource;
                audio.src = URL.createObjectURL(mediaSource);
                audio.play().catch(e => {
                    console.error("Audio play failed, falling back to browser TTS", e);
                    useBrowserTTS(cleanedText, handleEnd, selectedVoice);
                });

                mediaSource.addEventListener('sourceopen', async () => {
                    URL.revokeObjectURL(audio.src);
                    try {
                        const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
                        sourceBufferRef.current = sourceBuffer;
                        
                        sourceBuffer.addEventListener('updateend', () => {
                            isSourceBufferUpdatingRef.current = false;
                            if (audioQueueRef.current.length > 0) {
                                if (!sourceBuffer.updating && mediaSource.readyState === 'open') {
                                    sourceBuffer.appendBuffer(audioQueueRef.current.shift()!);
                                }
                            } else if (mediaSource.readyState === "open") {
                                try { mediaSource.endOfStream(); } catch(e) { console.warn("Error ending stream on updateend:", e); }
                            }
                        });

                        const reader = stream.getReader();
                        playbackEndFiredRef.current = false;
                        
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            if (sourceBuffer.updating || audioQueueRef.current.length > 0) {
                                audioQueueRef.current.push(value.buffer);
                            } else {
                                isSourceBufferUpdatingRef.current = true;
                                sourceBuffer.appendBuffer(value.buffer);
                            }
                        }
                    } catch (e) {
                         console.error("Error with MediaSource:", e);
                         useBrowserTTS(cleanedText, handleEnd, selectedVoice);
                    }
                });
                
                audio.onended = () => {
                    playbackEndFiredRef.current = true;
                    handleEnd();
                };
                audio.onerror = () => {
                    console.error("Audio element error during ElevenLabs playback.");
                    useBrowserTTS(cleanedText, handleEnd, selectedVoice);
                };

            } else {
                console.warn("generateSpeech returned null, falling back to browser TTS.");
                useBrowserTTS(cleanedText, handleEnd, selectedVoice);
            }
        } catch (error) {
            console.error("Error with ElevenLabs TTS, falling back to browser TTS:", error);
            useBrowserTTS(cleanedText, handleEnd, selectedVoice);
        }
    } else {
        useBrowserTTS(cleanedText, handleEnd, selectedVoice);
    }
  }, [selectedVoice, voices, useBrowserTTS, stopSpeaking]);
    
  const speakRef = useRef(speak);
  useEffect(() => { speakRef.current = speak; });

  const handleVideoSelect = useCallback((video: YouTubeSearchResult, index: number) => {
    setYoutubeVideoId(video.videoId);
    setYoutubeVideoTitle(video.title);
    setCurrentVideoIndex(index);
    setTargetPanel('youtube');
  }, []);

  const handleSkipToNextVideo = useCallback(() => {
    if (youtubeSearchResults.length > 0 && currentVideoIndex !== null) {
      const nextIndex = currentVideoIndex + 1;

      if (nextIndex < youtubeSearchResults.length) {
        const nextVideo = youtubeSearchResults[nextIndex];
        console.log(`Attempting to skip to next video: "${nextVideo.title}"`);
        
        setYoutubeVideoId(nextVideo.videoId);
        setCurrentVideoIndex(nextIndex);
        setYoutubeVideoTitle(nextVideo.title);
      } else {
        console.log("Reached end of search results while skipping unplayable videos.");
        speakRef.current("Maaf kijiye, mujhe is list mein koi chalaane yogy video nahi mila.", () => {
          setTargetPanel('none');
        });
      }
    }
  }, [currentVideoIndex, youtubeSearchResults]);

  // YouTube Player Effect - Reworked for robustness
  useEffect(() => {
    const createPlayer = (videoId: string) => {
      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        playerRef.current.destroy();
      }
      playerRef.current = new window.YT.Player('youtube-player-container', {
        height: '100%',
        width: '100%',
        videoId,
        playerVars: { autoplay: 1, fs: 1, playsinline: 1, controls: 1, rel: 0 },
        events: {
          onReady: (e: any) => {
            setAssistantStatusText('Playing: ' + (youtubeVideoTitle || 'video'));
            e.target.setVolume(volume);
          },
          onStateChange: (e: any) => {
            setIsPlaying(e.data === window.YT.PlayerState.PLAYING);
          },
          onError: (e: any) => {
            console.error(`YouTube Player Error. Code: ${e.data}.`);
            if ([2, 5, 100, 101, 150].includes(e.data)) {
                setAssistantStatusText("Playback error, trying next video...");
                handleSkipToNextVideo();
            }
          }
        },
      });
    };

    if (renderedPanel === 'youtube' && youtubeVideoId) {
      if (window.YT && window.YT.Player) {
        createPlayer(youtubeVideoId);
      } else {
        window.onYouTubeIframeAPIReady = () => {
          if (renderedPanel === 'youtube' && youtubeVideoId) {
             createPlayer(youtubeVideoId);
          }
        };
      }
    }
  }, [renderedPanel, youtubeVideoId, volume, handleSkipToNextVideo, youtubeVideoTitle]);

  const processAssistantResponse = useCallback(async (response: AssistantResponse) => {
    console.log("Processing assistant action:", response.action, response.params);

    const { action, params } = response;
    const player = playerRef.current;

    switch (action) {
      case AssistantAction.SearchYouTube:
        if (params?.query) {
          setAssistantStatusText(`Searching YouTube for "${params.query}"...`);
          setTargetPanel('none');
          const results = await searchYouTube(params.query);
          if (results.length > 0) {
            setYoutubeSearchResults(results);
            setTargetPanel('youtubeSearchResults');
          } else {
            speak(`Maaf kijiye, mujhe "${params.query}" ke liye koi video nahi mila.`);
          }
        }
        break;

      case AssistantAction.PlayMusic:
        if (params?.query) {
          setAssistantStatusText(`Searching for "${params.query}" to play...`);
          setTargetPanel('none');
          const results = await searchYouTube(params.query);
          if (results.length > 0) {
            setYoutubeSearchResults(results);
            handleVideoSelect(results[0], 0);
          } else {
            speak(`Maaf kijiye, mujhe "${params.query}" ke liye koi gaana nahi mila.`);
          }
        }
        break;
      
      case AssistantAction.PlayVideo:
        if (youtubeSearchResults.length > 0) {
            handleVideoSelect(youtubeSearchResults[0], 0);
        } else {
            speak("Maaf kijiye, chalaane ke liye koi search result nahi hai.");
        }
        break;

      case AssistantAction.Play:
        if (player && typeof player.playVideo === 'function') player.playVideo();
        break;

      case AssistantAction.Pause:
        if (player && typeof player.pauseVideo === 'function') player.pauseVideo();
        break;

      case AssistantAction.Volume:
        if (player && typeof player.getVolume === 'function' && params?.level !== undefined) {
            const currentVolume = player.getVolume();
            let newVolume = currentVolume;
            if (params.level === 'increase') {
                newVolume += 10;
            } else if (params.level === 'decrease') {
                newVolume -= 10;
            } else {
                newVolume = Number(params.level);
            }
            newVolume = Math.max(0, Math.min(100, newVolume)); // Clamp between 0-100
            setVolume(newVolume);
        }
        break;
      
      case AssistantAction.SetBrightness:
        if (params?.level !== undefined) {
          let newBrightness = brightness;
          if (params.level === 'increase') {
            newBrightness += 10;
          } else if (params.level === 'decrease') {
            newBrightness -= 10;
          } else {
            newBrightness = Number(params.level);
          }
          newBrightness = Math.max(20, Math.min(150, newBrightness)); // Clamp between 20-150%
          setBrightness(newBrightness);
        }
        break;
        
      case AssistantAction.OpenUrl:
        if (params?.url) window.open(params.url, '_blank', 'noopener,noreferrer');
        break;

      case AssistantAction.TellJoke:
        // The joke is in the replyText, no further action needed here.
        break;
      
      default:
        console.warn(`No specific UI handler for action: ${action}`);
        break;
    }
  }, [setTargetPanel, speak, setYoutubeSearchResults, setAssistantStatusText, handleVideoSelect, volume, brightness, youtubeSearchResults]);
  
  const startListeningRef = useRef(startListening);
  useEffect(() => { startListeningRef.current = startListening; });

  const executeActionAndContinueListening = useCallback((response: AssistantResponse) => {
    processAssistantResponse(response);

    const mediaActions = [
        AssistantAction.PlayMusic, AssistantAction.PlayVideo, AssistantAction.SearchYouTube,
        AssistantAction.NextVideo, AssistantAction.PreviousVideo, AssistantAction.Play, AssistantAction.Pause,
        AssistantAction.Volume, AssistantAction.SetBrightness
    ];

    if (mediaActions.includes(response.action)) {
        setTimeout(() => {
            if (assistantStateRef.current === 'idle') {
               startListeningRef.current();
            }
        }, 700); // Delay to prevent picking up its own voice
    }
  }, [processAssistantResponse]);

  const processTranscript = useCallback(async (text: string) => {
    if (!text) {
        setAssistantState('idle');
        return;
    };
    setAssistantState('thinking');
    setAssistantStatusText('Thinking...');
    stopSpeaking();
    try {
        const response = await handleTranscript(text, { activePanel: renderedPanel });
        speak(response.replyText, () => executeActionAndContinueListening(response));
    } catch (error: any) {
        console.error("Error processing transcript:", error);
        speak(`Maaf kijiye, kuch gadbad ho gayi. ${error.message}`);
    }
  }, [speak, stopSpeaking, executeActionAndContinueListening, renderedPanel]);
  
  const processTranscriptRef = useRef(processTranscript);
  useEffect(() => { processTranscriptRef.current = processTranscript; });

  // Speech Recognition Setup
  useEffect(() => {
    if (!('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      console.error("This browser doesn't support the Web Speech API.");
      setAssistantStatusText("Unsupported Browser");
      setAssistantState('error');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'hi-IN';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;
    
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      console.log("Speech recognition started.");
      recognitionActive.current = true;
    };

    recognition.onresult = (event: any) => {
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
      let interimTranscript = '';
      let finalTranscriptChunk = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscriptChunk += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      setTranscript(fullTranscriptRef.current + interimTranscript);
      if (finalTranscriptChunk.trim()) {
        fullTranscriptRef.current += finalTranscriptChunk.trim() + ' ';
        debounceTimeoutRef.current = window.setTimeout(() => {
          if (recognitionActive.current) {
            recognitionRef.current.stop();
          }
        }, 1500);
      }
    };

    recognition.onend = () => {
      console.log("Speech recognition ended.");
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
      recognitionActive.current = false;

      if (assistantStateRef.current === 'listening') {
        const finalSpokenText = fullTranscriptRef.current.trim();
        if (finalSpokenText) {
          processTranscriptRef.current(finalSpokenText);
        } else {
          setAssistantState('idle');
          setAssistantStatusText('Activate Assistant');
        }
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
          setAssistantState('error');
          setAssistantStatusText('Mic Error');
      } else {
        setAssistantState('idle');
      }
    };

    return () => {
        if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
        if (recognitionRef.current) {
            recognitionRef.current.onstart = null;
            recognitionRef.current.onresult = null;
            recognitionRef.current.onend = null;
            recognitionRef.current.onerror = null;
            recognitionRef.current.stop();
        }
    };
  }, []);

  return (
    <div className="w-screen h-screen flex flex-col items-center justify-center text-center p-4 overflow-hidden relative">
      {/* HUD Elements */}
      <div className="hud-element corner-bracket corner-top-left"></div>
      <div className="hud-element corner-bracket corner-top-right"></div>
      <div className="hud-element corner-bracket corner-bottom-left"></div>
      <div className="hud-element corner-bracket corner-bottom-right"></div>
      
      {/* Settings Button */}
       <button 
        onClick={() => setIsSettingsOpen(true)} 
        className="absolute top-5 right-5 text-primary-color p-2 z-20 hover:scale-110 transition-transform filter drop-shadow-[0_0_4px_var(--primary-color)]"
        aria-label="Open settings"
        >
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 0 2l-.15.08a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l-.22-.38a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1 0-2l.15-.08a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>
        </svg>
      </button>

      {/* Main Content Area */}
      <div className="relative z-10 flex flex-col items-center justify-center h-full w-full max-w-6xl mx-auto">
        <h1 className="text-5xl md:text-7xl font-bold glowing-text mb-2">KANISKA</h1>
        <p className="text-lg md:text-xl text-secondary-color mb-8 tracking-widest">{assistantStatusText}</p>
        
        {/* Arc Reactor Button */}
        <button 
          onClick={startListening} 
          className={`arc-container ${assistantState}`}
          disabled={assistantState !== 'idle' && assistantState !== 'error'}
          aria-label="Activate Assistant"
        >
          <div className="arc-ring ring-1"></div>
          <div className="arc-ring ring-2"></div>
          <div className="arc-ring ring-3"></div>
          <div className="arc-ring ring-4"></div>
          <div className="arc-core">
            <canvas ref={visualizerCanvasRef} width="180" height="180" className="absolute inset-0"></canvas>
            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="opacity-80">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>
            </svg>
          </div>
        </button>
        
        {/* Transcript & Reply Display */}
        <div className="mt-8 text-center h-20 w-full max-w-3xl px-4">
            <p className="text-lg text-secondary-color min-h-[28px]">{transcript}&nbsp;</p>
            <p className="text-xl text-primary-color font-bold min-h-[32px]">{assistantReply}&nbsp;</p>
        </div>
      </div>

       {/* Panel Display */}
       <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {renderedPanel !== 'none' && (
            <div className={`jarvis-panel pointer-events-auto flex flex-col ${isExiting ? 'animate-fade-out-scale-down' : 'animate-fade-in-scale-up'} ${
                renderedPanel === 'youtube'
                ? 'w-full h-full max-w-full max-h-full youtube-mode'
                : 'w-[90%] h-[80%] max-w-6xl max-h-[800px]'
            }`}>
              <div className={`panel-content-wrapper flex-grow flex flex-col overflow-hidden ${renderedPanel === 'youtube' ? 'p-0' : 'p-1'}`}>
                 {renderedPanel === 'youtube' && youtubeVideoId && (
                    <div id="youtube-player-container" className="w-full h-full bg-black transition-all duration-300" style={{ filter: `brightness(${brightness}%)` }}></div>
                 )}
                 {renderedPanel === 'youtubeSearchResults' && (
                    <div className="w-full h-full flex flex-col p-4">
                        <h2 className="text-2xl glowing-text mb-4 text-left px-2">YouTube Search Results</h2>
                        <div className="flex-grow overflow-y-auto pr-2">
                            {youtubeSearchResults.length > 0 ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {youtubeSearchResults.map((result, index) => (
                                        <button 
                                            key={result.videoId}
                                            onClick={() => handleVideoSelect(result, index)}
                                            className="bg-[rgba(0,20,30,0.7)] border border-[var(--border-color)] p-2 hover:border-primary-color transition-all duration-300 text-left group flex flex-col items-start"
                                            style={{
                                                boxShadow: '0 0 10px rgba(0, 234, 255, 0.1), inset 0 0 8px rgba(0, 234, 255, 0.1)',
                                                backdropFilter: 'blur(4px)'
                                            }}
                                        >
                                            <div className="aspect-video bg-black overflow-hidden w-full mb-2">
                                                <img src={result.thumbnailUrl} alt={result.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                                            </div>
                                            <h3 className="text-sm font-bold text-primary-color leading-tight line-clamp-2 px-1 flex-grow">{result.title}</h3>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-center text-secondary-color mt-8">No results to display.</p>
                            )}
                        </div>
                    </div>
                 )}
              </div>
            </div>
        )}
       </div>

      {/* Settings Modal */}
       {isSettingsOpen && (
         <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50" onClick={() => setIsSettingsOpen(false)}>
           <div className={`jarvis-panel w-[90%] max-w-md p-6 flex flex-col gap-4 animate-fade-in-scale-up`} onClick={e => e.stopPropagation()}>
              <div className="panel-content-wrapper">
                <h2 className="text-2xl glowing-text mb-4">Settings</h2>
                <div className="flex flex-col gap-2">
                  <label htmlFor="voice-select" className="text-secondary-color">Assistant Voice</label>
                  <select
                    id="voice-select"
                    value={selectedVoice}
                    onChange={e => setSelectedVoice(e.target.value)}
                    className="bg-[var(--panel-bg)] border border-[var(--border-color)] text-[var(--text-color)] p-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]"
                  >
                    <optgroup label="Premium Voices">
                      {ELEVENLABS_VOICES.map(v => <option key={v.id} value={`elevenlabs:${v.id}`}>{v.name}</option>)}
                    </optgroup>
                    <optgroup label="Browser Voices (Hindi)">
                      {browserHindiVoices.length > 0 ? (
                        browserHindiVoices.map(v => <option key={v.name} value={v.name}>{v.name}</option>)
                      ) : (
                        <option disabled>No Hindi voices found</option>
                      )}
                    </optgroup>
                  </select>
                </div>
                 <button onClick={() => setIsSettingsOpen(false)} className="mt-6 bg-transparent border border-primary-color text-primary-color px-4 py-2 hover:bg-primary-color hover:text-bg-color transition-colors w-full">Close</button>
              </div>
           </div>
         </div>
       )}

      <audio ref={audioRef} style={{ display: 'none' }}></audio>
    </div>
  );
};

export default App;