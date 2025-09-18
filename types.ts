export enum AssistantAction {
  SearchYouTube = "search_youtube",
  PlayVideo = "play_video",
  Pause = "pause",
  Stop = "stop",
  Play = "play",
  Volume = "volume",
  OpenUrl = "open_url",
  Reply = "reply",
  GetWeather = "get_weather",
  SetTimer = "set_timer",
  PlayMusic = "play_music",
  OpenApp = "open_app",
  StopListening = "stop_listening",
}

export interface AssistantResponse {
  action: AssistantAction;
  params: {
    query?: string;
    videoId?: string;
    level?: number | 'increase' | 'decrease';
    url?: string;
    duration?: number; // in seconds
    appName?: string;
    location?: string;
  };
  replyText: string;
}

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  thumbnailUrl: string;
}