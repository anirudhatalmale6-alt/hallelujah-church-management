import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload, Scissors, Download, Play, Pause, Film, Music,
  Image, Settings, Loader, Check, X, Volume2, Link, Youtube, RefreshCw
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '/system/api';

const WATERMARK_POSITIONS = [
  { id: 'top-left', label: 'Top Left' },
  { id: 'top-right', label: 'Top Right' },
  { id: 'bottom-left', label: 'Bottom Left' },
  { id: 'bottom-right', label: 'Bottom Right' },
];

const QUALITY_PRESETS = [
  { id: 'high', label: 'High', desc: 'Best quality' },
  { id: 'medium', label: 'Medium', desc: 'Balanced' },
  { id: 'low', label: 'Low', desc: 'Smallest file' },
];

const ACCEPTED_FORMATS = '.mp4,.mov,.avi,.mkv,.webm';

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

function parseTimeToSeconds(timeStr) {
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function extractYoutubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/live\/|youtube\.com\/v\/|youtube\.com\/watch\?.*[?&]v=)([a-zA-Z0-9_\-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function TimeInput({ label, value, onChange, max }) {
  const [text, setText] = useState(formatTime(value));

  useEffect(() => {
    setText(formatTime(value));
  }, [value]);

  const handleBlur = () => {
    let secs = parseTimeToSeconds(text);
    secs = Math.max(0, Math.min(secs, max || Infinity));
    onChange(secs);
    setText(formatTime(secs));
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</label>
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={e => e.key === 'Enter' && e.target.blur()}
        className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-center font-mono text-sm
                   focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-transparent"
        placeholder="00:00:00"
      />
    </div>
  );
}

function YouTubePlayer({ videoId, onTimeUpdate, onReady }) {
  const iframeRef = useRef(null);
  const playerRef = useRef(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!videoId) return;

    const loadApi = () => {
      if (window.YT && window.YT.Player) {
        createPlayer();
        return;
      }
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.body.appendChild(tag);
      }
      window.onYouTubeIframeAPIReady = createPlayer;
    };

    const createPlayer = () => {
      if (playerRef.current) {
        playerRef.current.destroy();
      }
      playerRef.current = new window.YT.Player(iframeRef.current, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 0, modestbranding: 1, rel: 0 },
        events: {
          onReady: (e) => {
            const dur = e.target.getDuration();
            onReady(dur);
            intervalRef.current = setInterval(() => {
              const t = e.target.getCurrentTime();
              if (t !== undefined) onTimeUpdate(t);
            }, 500);
          },
        },
      });
    };

    loadApi();

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch {}
      }
    };
  }, [videoId]);

  return (
    <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
      <div ref={iframeRef} className="w-full h-full" />
    </div>
  );
}

export default function ClipGeneratorPage() {
  const [mode, setMode] = useState('upload');

  const [file, setFile] = useState(null);
  const [fileUrl, setFileUrl] = useState(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeInfo, setYoutubeInfo] = useState(null);
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [youtubeVideoId, setYoutubeVideoId] = useState(null);

  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);

  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [watermarkPosition, setWatermarkPosition] = useState('bottom-right');
  const [watermarkSize, setWatermarkSize] = useState(80);

  const [outputFormat, setOutputFormat] = useState('mp4');
  const [quality, setQuality] = useState('medium');

  const [processing, setProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingStage, setProcessingStage] = useState('');

  const [outputUrl, setOutputUrl] = useState(null);
  const [outputFileName, setOutputFileName] = useState('');
  const [outputSize, setOutputSize] = useState(0);
  const [error, setError] = useState('');

  const [isDragOver, setIsDragOver] = useState(false);

  const videoRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [fileUrl]);

  const handleFile = (f) => {
    if (!f) return;
    setError('');
    setOutputUrl(null);
    setOutputFileName('');
    setOutputSize(0);
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    const url = URL.createObjectURL(f);
    setFile(f);
    setFileUrl(url);
    setStartTime(0);
    setEndTime(0);
    setCurrentTime(0);
    setIsPlaying(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const handleVideoLoaded = () => {
    if (videoRef.current) {
      const dur = videoRef.current.duration;
      setDuration(dur);
      setEndTime(dur);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
  };

  const togglePlayPause = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const seekTo = (time) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleStartChange = (val) => {
    setStartTime(Math.max(0, Math.min(val, endTime - 1)));
  };

  const handleEndChange = (val) => {
    setEndTime(Math.min(duration || Infinity, Math.max(val, startTime + 1)));
  };

  const removeSource = () => {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setFile(null);
    setFileUrl(null);
    setYoutubeInfo(null);
    setYoutubeVideoId(null);
    setYoutubeUrl('');
    setDuration(0);
    setCurrentTime(0);
    setStartTime(0);
    setEndTime(0);
    setIsPlaying(false);
    setOutputUrl(null);
    setOutputFileName('');
    setOutputSize(0);
    setError('');
  };

  const fetchYoutubeInfo = async () => {
    const id = extractYoutubeId(youtubeUrl);
    if (!id) {
      setError('Please enter a valid YouTube URL');
      return;
    }
    setYoutubeLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('hitc_token');
      const res = await fetch(`${API_BASE}/clip_process.php?youtube_info=${encodeURIComponent(youtubeUrl)}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch video info');
      setYoutubeInfo(data);
      setYoutubeVideoId(data.video_id);
      setDuration(data.duration);
      setEndTime(data.duration);
      setStartTime(0);
    } catch (err) {
      setError(err.message);
    }
    setYoutubeLoading(false);
  };

  const generateClip = async () => {
    setProcessing(true);
    setUploadProgress(0);
    setError('');
    setOutputUrl(null);
    setOutputFileName('');
    setOutputSize(0);

    try {
      const token = localStorage.getItem('hitc_token');
      const formData = new FormData();
      formData.append('start_time', startTime);
      formData.append('end_time', endTime);
      formData.append('quality', quality);
      formData.append('output_format', outputFormat);
      formData.append('watermark', watermarkEnabled ? '1' : '0');
      formData.append('watermark_position', watermarkPosition);
      formData.append('watermark_size', watermarkSize);

      if (mode === 'youtube') {
        formData.append('mode', 'youtube');
        formData.append('youtube_url', youtubeUrl);
        setProcessingStage('Downloading from YouTube...');
      } else {
        formData.append('mode', 'upload');
        formData.append('video', file);
        setProcessingStage('Uploading video...');
      }

      const xhr = new XMLHttpRequest();
      const result = await new Promise((resolve, reject) => {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = e.loaded / e.total;
            setUploadProgress(pct);
            if (pct >= 1) {
              setProcessingStage(mode === 'youtube' ? 'Downloading from YouTube...' : 'Processing with FFmpeg...');
            }
          }
        };
        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 400) reject(new Error(data.error || 'Server error'));
            else resolve(data);
          } catch {
            reject(new Error('Invalid server response'));
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.open('POST', `${API_BASE}/clip_process.php`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.send(formData);
      });

      setOutputUrl(result.download_url + '&filename=' + encodeURIComponent(result.filename));
      setOutputFileName(result.filename);
      setOutputSize(result.size);
      setProcessingStage('Complete!');
    } catch (err) {
      setError(err.message);
      setProcessingStage('');
    }
    setProcessing(false);
  };

  const handleDownload = () => {
    if (!outputUrl) return;
    const token = localStorage.getItem('hitc_token');
    const separator = outputUrl.includes('?') ? '&' : '?';
    window.open(`${API_BASE}${outputUrl.startsWith('/system/api') ? outputUrl.replace('/system/api', '') : outputUrl}${separator}token=${token}`, '_blank');
  };

  const clipDuration = endTime - startTime;
  const hasSource = mode === 'upload' ? !!file : !!youtubeInfo;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-8 text-center">
        <div className="flex items-center justify-center gap-3 mb-2">
          <Film className="text-gold-500" size={32} />
          <h1 className="text-3xl font-bold text-gray-900">Sermon Clip Generator</h1>
        </div>
        <p className="text-gray-500">
          Upload a video or paste a YouTube link to create clips for social media
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <X className="text-red-500 flex-shrink-0" size={18} />
          <span className="text-red-700 text-sm">{error}</span>
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Source Selection Tabs */}
      {!hasSource && (
        <div className="mb-6">
          <div className="flex gap-2 justify-center mb-6">
            <button
              onClick={() => setMode('upload')}
              className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all
                ${mode === 'upload'
                  ? 'bg-gold-100 text-gold-700 ring-2 ring-gold-400 shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              <Upload size={18} /> Upload File
            </button>
            <button
              onClick={() => setMode('youtube')}
              className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all
                ${mode === 'youtube'
                  ? 'bg-red-100 text-red-700 ring-2 ring-red-400 shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              <Youtube size={18} /> YouTube Link
            </button>
          </div>

          {mode === 'upload' ? (
            <div
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
              className={`card cursor-pointer border-2 border-dashed transition-all duration-200
                ${isDragOver
                  ? 'border-gold-500 bg-gold-50'
                  : 'border-gray-300 hover:border-gold-400 hover:bg-gray-50'
                } py-16 text-center`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_FORMATS}
                onChange={e => handleFile(e.target.files[0])}
                className="hidden"
              />
              <Upload className={`mx-auto mb-4 ${isDragOver ? 'text-gold-500' : 'text-gray-400'}`} size={48} />
              <p className="text-lg font-semibold text-gray-700 mb-1">Drop your sermon video here</p>
              <p className="text-sm text-gray-500 mb-4">or click to browse files</p>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {['MP4', 'MOV', 'AVI', 'MKV', 'WebM'].map(fmt => (
                  <span key={fmt} className="px-2.5 py-1 bg-gray-100 rounded-full text-xs font-medium text-gray-600">{fmt}</span>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-4">Videos are processed on the server for fast performance</p>
            </div>
          ) : (
            <div className="card py-10">
              <div className="max-w-xl mx-auto">
                <div className="flex items-center gap-2 mb-4 justify-center">
                  <Youtube className="text-red-500" size={24} />
                  <h3 className="font-semibold text-gray-900">Paste YouTube URL</h3>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={youtubeUrl}
                    onChange={e => setYoutubeUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && fetchYoutubeInfo()}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent"
                  />
                  <button
                    onClick={fetchYoutubeInfo}
                    disabled={youtubeLoading || !youtubeUrl.trim()}
                    className={`flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition-all
                      ${youtubeLoading || !youtubeUrl.trim()
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        : 'bg-red-500 hover:bg-red-600 text-white shadow-sm'}`}
                  >
                    {youtubeLoading ? <Loader className="animate-spin" size={16} /> : <Link size={16} />}
                    {youtubeLoading ? 'Loading...' : 'Load'}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-3 text-center">
                  Paste any YouTube video URL and we will download just the clip you need
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Source Loaded - Video Preview + Controls */}
      {hasSource && (
        <>
          <div className="card mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0
                  ${mode === 'youtube' ? 'bg-red-100' : 'bg-gold-100'}`}>
                  {mode === 'youtube' ? <Youtube className="text-red-600" size={20} /> : <Film className="text-gold-600" size={20} />}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">
                    {mode === 'youtube' ? youtubeInfo.title : file.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {mode === 'youtube'
                      ? `${youtubeInfo.uploader} · ${formatTime(duration)}`
                      : `${formatFileSize(file.size)} · ${formatTime(duration)}`
                    }
                  </p>
                </div>
              </div>
              <button
                onClick={removeSource}
                className="text-gray-400 hover:text-red-500 transition-colors p-1"
                title="Remove"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Video Preview */}
              <div>
                {mode === 'youtube' ? (
                  <YouTubePlayer
                    videoId={youtubeVideoId}
                    onTimeUpdate={setCurrentTime}
                    onReady={(dur) => {
                      if (dur) {
                        setDuration(dur);
                        setEndTime(dur);
                      }
                    }}
                  />
                ) : (
                  <>
                    <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
                      <video
                        ref={videoRef}
                        src={fileUrl}
                        onLoadedMetadata={handleVideoLoaded}
                        onTimeUpdate={handleTimeUpdate}
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                        onEnded={() => setIsPlaying(false)}
                        className="w-full h-full object-contain"
                      />
                      <button
                        onClick={togglePlayPause}
                        className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 transition-colors group"
                      >
                        <div className="w-14 h-14 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          {isPlaying ? <Pause className="text-white" size={24} /> : <Play className="text-white ml-1" size={24} />}
                        </div>
                      </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-gray-500 px-1">
                      <span className="font-mono">{formatTime(currentTime)}</span>
                      <span className="font-mono">{formatTime(duration)}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Trim Controls */}
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2 mb-1">
                  <Scissors className="text-gold-500" size={18} />
                  <h3 className="font-semibold text-gray-900">Trim Controls</h3>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Selection Range</label>
                    <div className="relative h-10 flex items-center">
                      <div className="absolute inset-x-0 h-2 bg-gray-200 rounded-full">
                        <div
                          className="absolute h-full bg-gold-400 rounded-full"
                          style={{
                            left: duration ? `${(startTime / duration) * 100}%` : '0%',
                            width: duration ? `${((endTime - startTime) / duration) * 100}%` : '100%',
                          }}
                        />
                      </div>
                      <input
                        type="range" min={0} max={duration || 100} step={1}
                        value={startTime}
                        onChange={e => handleStartChange(Number(e.target.value))}
                        className="absolute inset-x-0 w-full appearance-none bg-transparent pointer-events-auto cursor-pointer
                                   [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                                   [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gold-600 [&::-webkit-slider-thumb]:border-2
                                   [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md"
                        style={{ zIndex: 3 }}
                      />
                      <input
                        type="range" min={0} max={duration || 100} step={1}
                        value={endTime}
                        onChange={e => handleEndChange(Number(e.target.value))}
                        className="absolute inset-x-0 w-full appearance-none bg-transparent pointer-events-auto cursor-pointer
                                   [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                                   [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary-700 [&::-webkit-slider-thumb]:border-2
                                   [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md"
                        style={{ zIndex: 4 }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <TimeInput label="Start Time" value={startTime} onChange={handleStartChange} max={endTime - 1} />
                    <TimeInput label="End Time" value={endTime} onChange={handleEndChange} max={duration} />
                  </div>

                  {mode === 'upload' && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => seekTo(startTime)}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium
                                   bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
                      >
                        <Play size={12} /> Preview Start
                      </button>
                      <button
                        onClick={() => seekTo(Math.max(endTime - 3, startTime))}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium
                                   bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
                      >
                        <Play size={12} /> Preview End
                      </button>
                    </div>
                  )}

                  <div className="bg-gray-50 rounded-lg px-3 py-2 flex items-center justify-between">
                    <span className="text-xs text-gray-500">Clip Duration</span>
                    <span className="font-mono text-sm font-semibold text-gold-700">
                      {formatTime(clipDuration > 0 ? clipDuration : 0)}
                    </span>
                  </div>

                  {mode === 'youtube' && (
                    <div className="bg-blue-50 rounded-lg px-3 py-2 text-xs text-blue-700">
                      Only the selected portion will be downloaded from YouTube - no need to download the full video
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Settings Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {/* Watermark */}
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <Image className="text-gold-500" size={18} />
                <h3 className="font-semibold text-gray-900 text-sm">Watermark</h3>
              </div>
              <label className="flex items-center gap-3 cursor-pointer mb-3">
                <div className="relative">
                  <input type="checkbox" checked={watermarkEnabled} onChange={e => setWatermarkEnabled(e.target.checked)} className="sr-only" />
                  <div className={`w-10 h-6 rounded-full transition-colors ${watermarkEnabled ? 'bg-gold-500' : 'bg-gray-300'}`}>
                    <div className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform mt-1 ${watermarkEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                  </div>
                </div>
                <span className="text-sm text-gray-700">Add church logo</span>
              </label>
              {watermarkEnabled && (
                <div className="space-y-3 pt-2 border-t border-gray-100">
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1.5 block">Position</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {WATERMARK_POSITIONS.map(pos => (
                        <button
                          key={pos.id}
                          onClick={() => setWatermarkPosition(pos.id)}
                          className={`px-2 py-1.5 rounded-md text-xs font-medium transition-colors
                            ${watermarkPosition === pos.id
                              ? 'bg-gold-100 text-gold-700 ring-1 ring-gold-300'
                              : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
                        >
                          {pos.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-gray-500">Size</label>
                      <span className="text-xs text-gray-400">{watermarkSize}px</span>
                    </div>
                    <input type="range" min={40} max={200} value={watermarkSize} onChange={e => setWatermarkSize(Number(e.target.value))} className="w-full accent-gold-500" />
                  </div>
                </div>
              )}
            </div>

            {/* Output Format */}
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <Film className="text-gold-500" size={18} />
                <h3 className="font-semibold text-gray-900 text-sm">Output Format</h3>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setOutputFormat('mp4')}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-sm font-medium transition-all
                    ${outputFormat === 'mp4' ? 'bg-gold-100 text-gold-700 ring-2 ring-gold-400' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
                >
                  <Film size={16} /> MP4
                </button>
                <button
                  onClick={() => setOutputFormat('mp3')}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-sm font-medium transition-all
                    ${outputFormat === 'mp3' ? 'bg-gold-100 text-gold-700 ring-2 ring-gold-400' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
                >
                  <Music size={16} /> MP3
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                {outputFormat === 'mp4' ? 'Video clip with audio' : 'Audio only extract'}
              </p>
            </div>

            {/* Quality */}
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <Settings className="text-gold-500" size={18} />
                <h3 className="font-semibold text-gray-900 text-sm">Quality</h3>
              </div>
              <div className="space-y-1.5">
                {QUALITY_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => setQuality(preset.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all
                      ${quality === preset.id ? 'bg-gold-100 text-gold-700 ring-1 ring-gold-300' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
                  >
                    <span className="font-medium">{preset.label}</span>
                    <span className="text-xs opacity-60">{preset.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Processing Progress */}
          {processing && (
            <div className="card mb-6">
              <div className="flex items-center gap-3 mb-3">
                <Loader className="animate-spin text-gold-500" size={20} />
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{processingStage || 'Processing...'}</p>
                  {mode === 'upload' && uploadProgress < 1 && (
                    <p className="text-xs text-gray-500">Uploading: {Math.round(uploadProgress * 100)}%</p>
                  )}
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-gold-400 to-gold-600 rounded-full transition-all duration-300"
                  style={{ width: `${mode === 'upload' && uploadProgress < 1 ? uploadProgress * 100 : 50}%` }}
                />
              </div>
              {mode === 'upload' && uploadProgress >= 1 && (
                <p className="text-xs text-gray-400 mt-2 text-center">Server is processing your video with FFmpeg...</p>
              )}
              {mode === 'youtube' && (
                <p className="text-xs text-gray-400 mt-2 text-center">Downloading and processing from YouTube - this may take a minute...</p>
              )}
            </div>
          )}

          {/* Output Ready */}
          {outputUrl && !processing && (
            <div className="card mb-6 bg-green-50 border border-green-200">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                  <Check className="text-green-600" size={24} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-green-800">Clip ready!</p>
                  <p className="text-sm text-green-600 truncate">
                    {outputFileName} {outputSize > 0 && `· ${formatFileSize(outputSize)}`}
                  </p>
                </div>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl
                             font-semibold text-sm transition-colors shadow-sm flex-shrink-0"
                >
                  <Download size={18} /> Download
                </button>
              </div>
            </div>
          )}

          {/* Generate Button */}
          <div className="flex justify-center">
            <button
              onClick={generateClip}
              disabled={processing || clipDuration <= 0}
              className={`flex items-center gap-3 px-8 py-3.5 rounded-xl font-bold text-base shadow-lg transition-all
                ${processing || clipDuration <= 0
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none'
                  : 'bg-gradient-to-r from-gold-500 to-gold-600 hover:from-gold-600 hover:to-gold-700 text-white hover:shadow-xl active:scale-[0.98]'}`}
            >
              {processing ? (
                <><Loader className="animate-spin" size={20} /> Processing...</>
              ) : (
                <><Scissors size={20} /> Generate Clip</>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
