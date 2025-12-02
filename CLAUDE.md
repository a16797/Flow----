# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Flow批量上传** is a Chrome browser extension that provides automated batch video generation and batch downloading for Google Labs Flow platform. It enables users to process multiple images and prompts automatically through intelligent queue management, mode switching, and file handling.

### Key Features
- **Batch Video Generation**: Handles multiple images and prompts with queue management (max 4 concurrent tasks)
- **Batch Video Downloader**: Independent feature for downloading existing videos in bulk with custom naming
- **Smart Mode Recognition**: Automatically switches between generation modes (Frames/Ingredients/Text to Video/Create Image)
- **Auto-recovery**: Restores incomplete tasks after page refresh (with 30-minute expiry)
- **Intelligent Cropping**: Supports portrait (9:16), landscape (16:9), and square (1:1) aspect ratios
- **Auto-download**: Automatically downloads and renames generated videos
- **UI State Persistence**: Saves and restores user inputs across sessions

### Project Structure
```
FlowBatchPilot/
├── manifest.json          # Extension manifest (Manifest V3)
├── launcher.html          # Entry point popup (icon click)
├── launcher.js            # Launcher logic (page detection)
├── popup.html             # Main control panel UI
├── popup.js               # Control panel logic (file handling, UI)
├── content.js             # Core automation engine (queue, DOM, batch downloader)
├── background.js          # Background service worker (downloads)
├── icons/                 # Extension icons (16, 48, 128)
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
├── README.md              # User documentation
├── CLAUDE.md              # Developer documentation (this file)
└── gork_create-master/    # Legacy reference code (DEPRECATED - DO NOT USE)
```

**Active Files** (current implementation):
- `launcher.html` + `launcher.js` - Entry point (page detection)
- `popup.html` + `popup.js` - Main UI (floating panel)
- `content.js` - Core logic (queue management + batch downloader)
- `background.js` - Downloads (auto + batch)

**Deprecated Files** (in `gork_create-master/`):
- Old implementation - **DO NOT modify these files**

## Development Workflow

### Loading the Extension
1. Open Chrome Extensions page: `chrome://extensions/`
2. Enable "Developer mode" toggle
3. Click "Load unpacked" and select the project directory
4. Verify extension icon appears in browser toolbar

### Debugging
- **Launcher UI**: Click extension icon to see launcher.html
- **Popup Panel**: On Flow page, launcher opens floating panel (popup.html injected via iframe)
- **Content Script**: Open Developer Tools on Flow page (F12) → Console tab
- **Background Worker**: Extensions page → "Service Worker" link for background.js
- **Logs**: Look for `[FlowBatchPilot]` prefix in console logs

**Common Debug Scenarios**:
- **Queue stuck**: Check `queueRunning` state in content script console
- **File upload failed**: Verify file cache in popup.js via `this.preloadedFiles` in console
- **Mode switching error**: Inspect XPath selectors - Flow page DOM may have changed
- **Download failure**: Check background.js service worker logs for download errors
- **Batch downloader not showing**: Check if `initBatchDownloader()` was called in constructor

### Reloading During Development
- After code changes, go to `chrome://extensions/`
- Click reload button (↻) for the extension
- Refresh the target Google Labs Flow page if content script was modified

### Testing Environment
- **Target URL**: https://labs.google/fx/tools/flow
- **Required Permissions**: Access to labs.google domain, storage, downloads, scripting

## Core Architecture

### Four-Component Architecture

```
┌─────────────────┐
│   Launcher      │  (Entry Point)
│ (launcher.js)   │
│                 │
│ • Page Detection│
│ • Status Display│
│ • Quick Actions │
└────────┬────────┘
         │
         ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Popup Panel   │───▶│  Content Script │───▶│  Background     │
│  (popup.js)     │    │   (content.js)  │    │ (background.js) │
│  (iframe)       │    │                 │    │                 │
│                 │    │ • DOM Automation│    │ • File Download │
│ • User Input    │    │ • Mode Switching│    │   - Auto Download│
│ • File Selection│    │ • Queue Mgmt    │    │   - Batch Download│
│ • Status Display│    │ • Video Gen     │    │ • Cross-tab Comm│
│ • UI Persistence│    │ • Batch Download│    │ • Storage        │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Component Responsibilities

#### Launcher Script (`launcher.js`) - Entry Point
- **Page Detection**: Detects if current tab is Google Labs Flow page
- **Status Display**: Shows connection status (detected/not detected)
- **Quick Actions**:
  - Open control panel (if on Flow page)
  - Navigate to Flow page (if not on Flow page)
  - Refresh page
  - Open help documentation

#### Popup Panel (`popup.js`) - Main Control Panel
**IMPORTANT**: Popup is injected as an **iframe** by content.js, not a traditional browser action popup.

- **UI State Management**: Real-time status updates, progress tracking
- **File Handling**:
  - File selection via directory picker
  - Preview generation
  - **NO CSV import** (feature not implemented)
- **Task Configuration**: Mode selection, cropping settings, metadata preparation
- **UI Persistence**: Saves and restores user inputs across sessions (prompts, mode, crop settings)
- **Message Coordination**: Communicates with content script via Chrome messaging API
- **File Caching**: Uses `preloadedFiles` Map for in-memory file storage
  - **NO IndexedDB**: FileCacheDB is not implemented, files only cached in memory

#### Content Script (`content.js`) - Core Automation Engine
- **DOM Manipulation**: Element identification using XPath and selectors
- **Mode Switching**: Intelligent detection and switching between generation modes
- **Queue Management**: Atomic state updates (`_updatingState` lock), task sequencing, auto-recovery
- **File Operations**: Conditional file uploads, cropping automation
- **Video Processing**: Generation monitoring, download triggering
- **Floating Panel Injection**: Injects popup.html as iframe (`injectFloatingWidget()`)
- **Batch Downloader**: Independent video batch download feature (`initBatchDownloader()`)
  - Scans for video elements on page
  - Creates floating download button (bottom-left, draggable)
  - Shows download panel with video selection
  - Supports custom file naming and batch prefix
  - **Reverse numbering**: Downloads in reverse order (first selected → highest number)

#### Background Service Worker (`background.js`) - Download Manager
- **Dual Download Modes**:
  - **Auto Download** (`FLOW_BATCH_DOWNLOAD` message): Triggered after each video generation
  - **Batch Download** (`downloadVideo` action): Standalone batch download feature
- **File Naming**: Safe filename sanitization (`sanitizeFilename` - removes illegal characters: `\/:*?"<>|`)
- **Download Conflict Handling**: Uses `uniquify` strategy to prevent overwrites
- **Cross-tab Communication**: Handles communication between extension components
- **Storage Management**: Persistent data storage using Chrome Storage API

## Key Configuration

### Complete Timing Configuration (content.js:23-41)

#### Core CONFIG Object
```javascript
static CONFIG = {
  // === Queue Management ===
  QUEUE_LIMIT: 4,                     // Flow queue concurrent limit (prevents rate limiting)
  QUEUE_CHECK_INTERVAL: 2500,         // Queue space check interval (2.5s) - prevents frequent polling
  QUEUE_STATUS_LOG_INTERVAL: 8,       // Log every Nth check to reduce spam
  QUEUE_CAPACITY_TIMEOUT: 120 * 1000, // Max wait for queue space (2 minutes)
  QUEUE_THROTTLE_DELAY: 40 * 1000,    // Retry delay when queue is full (40s)

  // === Task Processing ===
  TASK_DELAY: 12000,                  // Delay between tasks (12s) - prevents rate limiting
  PENDING_TASKS_WAIT: 12000,          // Wait for pending tasks completion (12s)

  // === Video Generation ===
  VIDEO_GENERATION_TIMEOUT: 200 * 1000, // Video generation timeout (200s = 3min 20s)
  VIDEO_LOAD_TIMEOUT: 6 * 1000,       // Video load timeout (6s)

  // === UI Interaction ===
  ELEMENT_WAIT_INTERVAL: 1000,        // Element wait check interval (1s)
  CLICK_DELAY: 400,                   // Delay after clicks (0.4s)
  SCROLL_DELAY: 800,                  // Delay after scrolling (0.8s)

  // === Rate Limit and Error Detection ===
  ERROR_POLL_INTERVAL: 1000,          // Error detection poll interval (1s)
  ERROR_POLL_MAX_ATTEMPTS: 5,         // Max error detection attempts (5 attempts)
  RATE_LIMIT_RETRY_DELAY: 10000,      // Rate limit retry delay (10s)
  VIDEO_SRC_LOAD_WAIT: 5000,          // Video src load wait (5s)
};
```

**CRITICAL**: These are the actual values in code. Previous documentation had outdated values.

#### Additional Timing Constants
```javascript
// === Dialog/Popup Operations ===
await this.sleep(800);        // File upload completion delay
await this.sleep(1000);       // Mode switching delay
await this.sleep(1500);       // Settings dialog open delay
await this.sleep(500);        // Crop option selection delay

// === Pause/Resume Operations ===
await this.sleep(1000);       // Queue pause check interval
await this.sleep(5000);       // Long-running wait check interval
```

### Rate Limiting Prevention Strategy

The timing configuration is designed to prevent Google Labs rate limiting:

1. **Task delay (12s)** - Primary defense: delays between task submissions
2. **Queue throttle delay (40s)** - Backs off when queue is full
3. **Queue check interval (2.5s)** - Reduces polling frequency
4. **Video generation timeout (200s)** - Allows sufficient time for processing
5. **Error detection** - Detects rate limit errors and retries with delay

**Critical**: If encountering rate limit errors, increase `TASK_DELAY` and `QUEUE_THROTTLE_DELAY` values.

### Mode Recognition Logic
The extension automatically detects and switches between:
- **Frames to Video** (帧转视频) - Requires image upload
- **Ingredients to Video** (素材转视频) - Requires image upload
- **Text to Video** (文本转视频) - No images required
- **Create Image** (生成图片) - Generates static images

## Common Development Tasks

### Adding New Generation Modes
1. Update mode detection logic in `content.js`
   - Modify `getModeText()` function (content.js:1148-1156)
   - Add new mode constants to metadata structure
2. Add mode-specific XPath selectors
   - Locate `findModeOption()` function (content.js:1099-1146)
   - Add selectors for new mode buttons
3. Update `needsImageUpload()` function (content.js:2259-2262)
   - Define which modes require image upload
4. Test with Google Labs Flow interface changes
   - Verify mode detection works with English/Chinese interfaces
   - Test mode switching reliability

### Modifying Queue Behavior
- **Adjust concurrent limit**: Change `QUEUE_LIMIT` in CONFIG (content.js:24)
- **Modify check intervals**: Update `QUEUE_CHECK_INTERVAL` (content.js:25)
- **Update timeouts**: Adjust `QUEUE_CAPACITY_TIMEOUT` and `VIDEO_GENERATION_TIMEOUT` (content.js:27, 30)
- **Change delays**: Modify `TASK_DELAY` for rate limiting (content.js:29)

### File Handling Changes
- **File caching**: Implemented in `popup.js` using `preloadedFiles` Map (popup.js:19)
- **Dynamic transfer**: Via Chrome messaging API - see `handleFileRequest()` (popup.js:393-467)
- **NO CSV import**: This feature is NOT implemented, despite being mentioned in old docs
- **NO IndexedDB**: FileCacheDB is NOT implemented, files only in memory

### Modifying Download Behavior
- **Auto-download naming**: Edit `downloadVideo()` in content.js (content.js:3127-3153)
  - Format: `{taskIndex+1}_{promptSnippet}_{timestamp}.mp4`
- **Batch download**: Modify `downloadSelectedVideos()` in content.js (content.js:2656-2715)
  - Reverse numbering logic: `totalSelected - selectionIndex`
  - Filename format with prefix: `{prefix}_{reverseNumber}-{baseName}.mp4`
- **Sanitization rules**: Update `sanitizeFilename()` in background.js (background.js:88-93)
- **Conflict handling**: Change `conflictAction` in download API calls (background.js:25, 61)

### Modifying Batch Downloader
- **Button styling**: Edit CSS in `injectFloatingWidget()` (content.js:2717-3039)
- **Video scanning**: Modify `scanForVideos()` (content.js:2403-2449)
- **Panel UI**: Update `showDownloadPanel()` (content.js:2553-2590)
- **Reverse numbering**: Change logic in `downloadSelectedVideos()` (content.js:2682-2715)

### Debugging Mode Issues
- **Check XPath selectors**: Inspect Flow page DOM structure in DevTools
- **Verify element wait times**: Adjust `ELEMENT_WAIT_INTERVAL` (content.js:32)
- **Test mode detection**: Use browser console to test mode name matching
- **Monitor queue state**: Check `this.queueState` in content script console
- **Validate file cache**: Verify `this.preloadedFiles` in popup console

## Code Standards

### Naming Conventions
- **Variables**: camelCase (e.g., `queueRunning`, `currentTaskPointer`)
- **Classes**: PascalCase (e.g., `FlowBatchContentScript`, `FlowBatchPilot`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `QUEUE_LIMIT`, `VIDEO_GENERATION_TIMEOUT`)
- **Functions**: camelCase with descriptive verbs (e.g., `handleStartQueue`, `injectFloatingWidget`)

### Error Handling Patterns
```javascript
// Async operations with comprehensive error handling
try {
  const result = await someAsyncOperation();
  this.log('Operation successful', 'success');
  return result;
} catch (error) {
  this.log(`Operation failed: ${error.message}`, 'error');
  // Attempt recovery or fallback
}
```

### State Management
- **Atomic Updates**: Use `_updatingState` lock to prevent race conditions
- **State Synchronization**: Memory state ↔ Chrome Storage API
- **Auto-recovery**: State restoration after page refresh via `initializeAutoResume()`
  - Queues older than 30 minutes are automatically cleared
  - Only active/pending queues are auto-resumed

### Message Handling
- Use Chrome Runtime messaging for component communication
- Implement proper async response handling
- Include error responses for all message types

## Important Implementation Details

### Floating Panel Architecture
**CRITICAL**: The popup panel is NOT a traditional browser action popup. It's injected as an iframe:

1. User clicks extension icon → `launcher.html` opens
2. Launcher detects Flow page → sends `FLOW_BATCH_OPEN_PANEL` message
3. Content script receives message → calls `showFloatingPanel()`
4. `injectFloatingWidget()` creates iframe with `popup.html` as source
5. Popup communicates with content script via Chrome messaging

### File Transfer Architecture
- **Memory Caching**: Files cached in `popup.js` using `preloadedFiles` Map (popup.js:19)
- **On-Demand Transfer**: Content script requests files via `FLOW_BATCH_REQUEST_FILE` message
- **File Format**: Files transmitted as base64-encoded strings
- **NO Persistent Storage**: Files only in memory - Chrome Storage only stores metadata
- **NO IndexedDB**: FileCacheDB references exist but are not implemented
- **Cache Lifecycle**: File cache cleared when new queue starts (content.js:193, 248)

### UI State Persistence
- **Persistent Data**: Prompts, flow mode, crop mode, file metadata (NOT actual files)
- **Storage Key**: `flowBatchUIState` in Chrome Storage Local (popup.js:235)
- **Auto-Save**: Triggers on input changes (`saveUIState` - popup.js:221-240)
- **Auto-Restore**: Loads on popup initialization (`restoreUIState` - popup.js:172-198)
- **File Limitation**: Cannot restore actual File objects, only metadata

### Queue Management Strategy
- **Atomic Updates**: Uses `_updatingState` lock to prevent race conditions (content.js:48)
- **Rate Limiting**: Throttled to respect Google Labs limits
- **Capacity Management**: Intelligent waiting when queue capacity is full (max 4 concurrent)
- **Auto-Recovery**: State restoration after page refresh via `initializeAutoResume()` (content.js:3175-3247)
  - Checks for stale queues (>30 minutes old)
  - Only resumes active/pending queues
  - Clears corrupted state
- **Force Clear**: User can force-clear stuck queues (content.js:246-254)
- **Retry Logic**: Automatic retry up to 3 times for failed tasks (content.js:392-441)

### Batch Downloader Implementation
- **Initialization**: Called in constructor `initBatchDownloader()` (content.js:52)
- **Video Detection**: MutationObserver watches for video elements (content.js:2456-2480)
- **Floating Button**: Bottom-left corner, draggable (content.js:2483-2550)
- **Panel UI**: Modal-style panel with video list (content.js:2553-2590)
- **Reverse Numbering**: `reverseNumber = totalSelected - selectionIndex` (content.js:2688)
  - First selected video → highest number
  - Last selected video → number 1
- **Batch Prefix**: Stored in localStorage with key `flow_download_prefix` (content.js:2565, 2633)

### Error Detection and Handling
- **Rate Limit Detection**: Searches for "requesting generations too quickly" message (content.js:2273-2336)
- **Video Generation Failure**: Detects "Couldn't generate video" messages
- **Retry Logic**: Uses custom `RetryTaskError` class (content.js:14-19)
- **Max Retries**: 3 attempts per task (content.js:408-441)

## Browser Compatibility

- **Chrome Version**: 88+ (Manifest V3 requirement)
- **Target Platform**: Google Labs Flow (labs.google/fx/tools/flow)
- **Permissions**: storage, downloads, scripting, activeTab
- **Host Permissions**: https://labs.google/*

## Message Communication Protocol

### Message Types (Chrome Runtime Messaging)

**Launcher → Content Script**:
- `FLOW_BATCH_OPEN_PANEL` - Open floating control panel

**Popup → Content Script**:
- `PING` - Check content script availability (not implemented)
- `FLOW_BATCH_START` - Start queue with metadata
- `FLOW_BATCH_PAUSE` - Pause running queue
- `FLOW_BATCH_CLEAR` - Clear queue and reset state

**Content Script → Popup**:
- `FLOW_BATCH_STATUS_UPDATE` - Queue status changes (progress, counts, state)
- `FLOW_BATCH_LOG_ENTRY` - Log messages for popup display
- `FLOW_BATCH_REQUEST_FILE` - Request file by index from popup cache

**Content Script → Background**:
- `FLOW_BATCH_DOWNLOAD` - Auto-download video after generation
- `{action: 'downloadVideo'}` - Batch download video request

### Chrome Storage Keys

**Storage Keys Used**:
- `flowBatchQueueState` - Current queue state (progress, status, counts)
- `flowBatchTaskMetadata` - Task configuration metadata
- `flowBatchUIState` - UI state persistence (prompts, mode, crop settings)

**Storage Data Limits**:
- Metadata only (<1KB per key)
- Files NOT stored (memory only via `preloadedFiles` Map)

**LocalStorage Keys** (for batch downloader):
- `flow_download_prefix` - Saved batch download prefix

## Key Functions Reference

### Content Script (`content.js`)
- `handleStartQueue(metadata)` - Initialize and start queue processing (132-231)
- `handlePauseQueue()` - Pause queue execution (233-244)
- `handleClearQueue()` - Clear queue and reset state (246-254)
- `processQueue()` - Core task processing loop (307-479)
- `processTask(taskIndex)` - Process individual task (485-612)
- `waitForTaskCompletion(taskIndex, prompt, videoCountBeforeSubmit)` - Background completion handler (615-678)
- `ensureCorrectMode(targetMode)` - Mode switching automation (707-753)
- `updateQueueState(updates)` - Atomic state updates with lock (2104-2158)
- `initializeAutoResume()` - Auto-recovery on page refresh (3175-3247)
- `injectFloatingWidget()` - Inject control panel UI as iframe (2717-3039)
- `initBatchDownloader()` - Initialize batch download feature (2391-2401)
- `scanForVideos()` - Scan page for video elements (2403-2449)
- `showDownloadPanel()` - Show batch download panel (2553-2590)
- `downloadSelectedVideos()` - Download selected videos with reverse numbering (2656-2715)

### Popup Script (`popup.js`)
- `handleFileRequest(fileIndex, sendResponse)` - Transfer files to content script (393-467)
- `saveUIState()` - Persist UI state to storage (221-240)
- `restoreUIState(uiState)` - Restore UI state on load (172-198)
- `handleStatusUpdate(data)` - Update UI from content script status (761-771)
- `addLogEntry(message, type)` - Add log message to display (777-799)
- `updatePreview()` - Update task preview table (500-542)
- `startQueue()` - Build metadata and start queue (555-622)

### Background Script (`background.js`)
- `sanitizeFilename(name)` - Safe filename sanitization (88-93)
- Message handlers for download requests (7-86)

### Launcher Script (`launcher.js`)
- `detectActiveTab()` - Detect if current tab is Flow page (36-48)
- `updateStatus(detected, tabUrl)` - Update launcher UI status (14-34)

## Critical Notes for AI Assistants

1. **NO CSV Import**: Despite old documentation, CSV import is NOT implemented. Do not suggest it.
2. **NO FileCacheDB**: IndexedDB caching is NOT implemented. Files are memory-only.
3. **Popup is Iframe**: Not a traditional popup, it's injected as iframe by content script.
4. **Batch Downloader**: Fully implemented and functional - uses reverse numbering.
5. **Auto-Recovery**: Queues older than 30 minutes are auto-cleared (not infinite recovery).
6. **Config Values**: Use actual values from content.js:23-41, not old documentation values.
7. **Retry Logic**: 3 retries max per task using `RetryTaskError` class.
8. **Deprecated Code**: Ignore `gork_create-master/` directory entirely.