export enum AssistantAction {
  // Media & Playback
  SearchYouTube = "search_youtube",
  PlayVideo = "play_video",
  PlayMusic = "play_music",
  NextVideo = "next_video",
  PreviousVideo = "previous_video",
  Pause = "pause",
  Play = "play",
  Stop = "stop",
  Volume = "volume",
  SetBrightness = "set_brightness",

  // Productivity
  CreateNote = "create_note",
  SetReminder = "set_reminder",
  
  // Browser Control
  OpenUrl = "open_url",
  ManageTabs = "manage_tabs",
  BrowserHistory = "browser_history",

  // File System (User-Initiated)
  OpenFile = "open_file",
  ReadFile = "read_file",
  WriteFile = "write_file",
  EditFile = "edit_file",

  // Information
  GetWeather = "get_weather",
  GetDateTime = "get_date_time",
  TellJoke = "tell_joke",
  WebSearch = "web_search",
  
  // Code & Simulated Actions
  GenerateCode = "generate_code",
  SimulateAppControl = "simulate_app_control",
  SimulatePhoneControl = "simulate_phone_control",

  // Core Assistant Actions
  Reply = "reply",
  StopListening = "stop_listening",
}

export interface AssistantResponse {
  action: AssistantAction;
  params: {
    // General
    query?: string;
    url?: string;
    replyText?: string; 

    // Media
    videoId?: string;
    level?: number | 'increase' | 'decrease' | string;

    // Productivity
    noteContent?: string;
    reminderText?: string;
    duration?: number; // in seconds

    // Browser
    tabAction?: 'new' | 'close' | 'go_to';
    historyAction?: 'back' | 'forward';

    // File System
    editInstruction?: string;
    contentToWrite?: string;

    // Information
    location?: string;
    
    // Code & Simulation
    codeLanguage?: string;
    codeDescription?: string;
    appName?: string;
    phoneAction?: 'text' | 'call';
    phoneRecipient?: string;
    message?: string;
  };
  replyText: string;
  code?: string;
}

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  channelName: string;
}

export interface WebSearchResult {
  uri: string;
  title: string;
}

export interface Reminder {
  id: number;
  text: string;
  timeoutId: number;
}