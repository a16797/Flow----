# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**FlowBatchPilot** is a Chrome browser extension that provides automated batch video generation for Google Labs Flow platform. It enables users to process multiple images and prompts automatically through intelligent queue management, mode switching, and file handling.

### Key Features
- **Batch Processing**: Handles multiple images and prompts with queue management (max 5 concurrent tasks)
- **Smart Mode Recognition**: Automatically switches between generation modes (Frames/Ingredients/Text to Video)
- **Auto-recovery**: Restores incomplete tasks after page refresh
- **Intelligent Cropping**: Supports both portrait (9:16) and landscape (16:9) aspect ratios
- **Auto-download**: Automatically downloads and renames generated videos
- **Batch Downloader**: Independent feature for downloading existing videos in bulk

### Project Structure
```
FlowBatchPilot/
├── manifest.json          # Extension manifest (Manifest V3)
├── launcher.html          # Entry point popup (icon click)
├── launcher.js            # Launcher logic (page detection)
├── popup.html             # Main control panel UI
├── popup.js               # Control panel logic (file handling, UI)
├── content.js             # Core automation engine (queue, DOM)
├── background.js          # Background service worker (downloads)
├── icons/                 # Extension icons (16, 48, 128)
├── README.md              # User documentation
├── CLAUDE.md              # Developer documentation (this file)
└── gork_create-master/    # Legacy reference code (deprecated)
```

**Active Files** (these are the current implementation):
- `launcher.html` + `launcher.js` - Entry point
- `popup.html` + `popup.js` - Main UI
- `content.js` - Core logic
- `background.js` - Downloads

**Deprecated Files** (in `gork_create-master/`):
- Old implementation - DO NOT modify these files

## Development Workflow

### Loading the Extension
1. Open Chrome Extensions page: `chrome://extensions/`
2. Enable "Developer mode" toggle
3. Click "Load unpacked" and select the project directory
4. Verify extension icon appears in browser toolbar

### Debugging
- **Launcher UI**: Right-click extension icon → "Inspect popup" (shows launcher.html)
- **Popup Panel**: On Flow page, open floating panel, then right-click → "Inspect" (shows popup.html)
- **Content Script**: Open Developer Tools on Flow page (F12) → Console tab
- **Background Worker**: Extensions page → "Service Worker" link for background.js
- **Logs**: Look for `[FlowBatchPilot]` prefix in console logs

**Common Debug Scenarios**:
- **Queue stuck**: Check `queueRunning` state in content script console
- **File upload failed**: Verify file cache in popup.js via `this.preloadedFiles` in console
- **Mode switching error**: Inspect XPath selectors - Flow page DOM may have changed
- **Download failure**: Check background.js service worker logs for download errors

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
│   Popup UI      │───▶│  Content Script │───▶│  Background     │
│  (popup.js)     │    │   (content.js)  │    │ (background.js) │
│                 │    │                 │    │                 │
│ • User Input    │    │ • DOM Automation│    │ • File Download │
│ • File Selection│    │ • Mode Switching│    │   - Auto Download│
│ • Status Display│    │ • Queue Mgmt    │    │   - Batch Download│
│ • UI Persistence│    │ • Video Gen     │    │ • Cross-tab Comm│
│ • CSV Import    │    │ • Batch Download│    │ • Storage        │
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

#### Popup Script (`popup.js`) - Main Control Panel
- **UI State Management**: Real-time status updates, progress tracking
- **File Handling**:
  - File selection with drag-and-drop support
  - CSV import with multiple format support (single column, with headers, multi-column)
  - Preview generation with thumbnail caching
- **Task Configuration**: Mode selection, cropping settings, metadata preparation
- **UI Persistence**: Saves and restores user inputs across sessions (prompts, mode, crop settings)
- **Message Coordination**: Communicates with content script via Chrome messaging API
- **File Caching**: Uses `preloadedFiles` Map for in-memory file storage

#### Content Script (`content.js`) - Core Automation Engine
- **DOM Manipulation**: Element identification using XPath and selectors
- **Mode Switching**: Intelligent detection and switching between generation modes
- **Queue Management**: Atomic state updates (`_updatingState` lock), task sequencing, auto-recovery
- **File Operations**: Conditional file uploads, cropping automation
- **Video Processing**: Generation monitoring, download triggering
- **Batch Downloader**: Independent video batch download feature (content.js:39)

#### Background Service Worker (`background.js`) - Download Manager
- **Dual Download Modes**:
  - **Auto Download**: Triggered after each video generation (FLOW_BATCH_DOWNLOAD message)
  - **Batch Download**: Standalone batch download feature (downloadVideo action)
- **File Naming**: Safe filename sanitization (`sanitizeFilename` - removes illegal characters: `\/:*?"<>|`)
- **Download Conflict Handling**: Uses `uniquify` strategy to prevent overwrites
- **Cross-tab Communication**: Handles communication between extension components
- **Storage Management**: Persistent data storage using Chrome Storage API

## Key Configuration

### Complete Timing Configuration (content.js:15-28)

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
  VIDEO_GENERATION_TIMEOUT: 80 * 1000, // Video generation timeout (80s)
  VIDEO_LOAD_TIMEOUT: 6 * 1000,       // Video load timeout (6s)

  // === UI Interaction ===
  ELEMENT_WAIT_INTERVAL: 1000,        // Element wait check interval (1s)
  CLICK_DELAY: 400,                   // Delay after clicks (0.4s)
  SCROLL_DELAY: 800,                  // Delay after scrolling (0.8s)
};
```

**Note**: These values may differ from earlier versions. Always refer to the actual code in content.js:15-28 for current values.

#### Additional Timing Constants
```javascript
// === Dialog/Popup Operations ===
await this.sleep(800);        // File upload completion delay
await this.sleep(1000);       // Mode switching delay
await this.sleep(1500);       // Settings dialog open delay
await this.sleep(500);        // Crop option selection delay

// === Submission Flow ===
await this.sleep(60000);      // Post-submission delay (60s) - critical for rate limiting

// === Pause/Resume Operations ===
await this.sleep(1000);       // Queue pause check interval
await this.sleep(5000);       // Long-running wait check interval
```

### Rate Limiting Prevention Strategy

The timing configuration is designed to prevent Google Labs rate limiting:

1. **Task delay (12s)** - Primary defense: delays between task submissions prevent rapid-fire requests
2. **Queue throttle delay (40s)** - Backs off when queue is full to avoid overwhelming Flow
3. **Queue check interval (2.5s)** - Reduces polling frequency to minimize server load
4. **Video generation timeout (80s)** - Allows sufficient time for complex prompt processing
5. **Post-submission delays** - Additional hardcoded delays in submission flow for stability

**Critical**: If encountering rate limit errors, increase `TASK_DELAY` and `QUEUE_THROTTLE_DELAY` values.

### Mode Recognition Logic
The extension automatically detects and switches between:
- **Frames to Video** (帧转视频) - Requires image upload
- **Ingredients to Video** (素材转视频) - Requires image upload
- **Text to Video** (文本转视频) - No images required

## Common Development Tasks

### Adding New Generation Modes
1. Update mode detection logic in `content.js`
   - Modify mode name mappings (search for "帧转视频", "素材转视频", "文本转视频")
   - Add new mode constants to metadata structure
2. Add mode-specific XPath selectors
   - Locate element identification sections (look for `document.evaluate`)
   - Add selectors for new mode buttons and validation elements
3. Implement mode switching automation
   - Update `switchToMode()` function logic
   - Add mode-specific validation checks
4. Test with Google Labs Flow interface changes
   - Verify mode detection works with English/Chinese interfaces
   - Test mode switching reliability

### Modifying Queue Behavior
- **Adjust concurrent limit**: Change `QUEUE_LIMIT` in CONFIG object (content.js:16)
- **Modify check intervals**: Update `QUEUE_CHECK_INTERVAL` (content.js:17)
- **Update timeouts**: Adjust `QUEUE_CAPACITY_TIMEOUT` and `VIDEO_GENERATION_TIMEOUT` (content.js:19, 22)
- **Change delays**: Modify `TASK_DELAY` for rate limiting (content.js:21)

### File Handling Changes
- **File caching**: Implemented in `popup.js` using `preloadedFiles` Map (popup.js:19)
- **Dynamic transfer**: Via Chrome messaging API - see `handleFileRequest()` (popup.js:120-122)
- **CSV import**: Update parsing logic in CSV import handler
  - Single column format
  - Header detection ("prompt" column)
  - Multi-column support with auto-detection

### Modifying Download Behavior
- **Auto-download naming**: Edit filename generation in content script download trigger
- **Batch download**: Modify batch downloader initialization (content.js:39)
- **Sanitization rules**: Update `sanitizeFilename()` in background.js (background.js:88-93)
- **Conflict handling**: Change `conflictAction` in download API calls (background.js:25, 61)

### Debugging Mode Issues
- **Check XPath selectors**: Inspect Flow page DOM structure in DevTools
- **Verify element wait times**: Adjust `ELEMENT_WAIT_INTERVAL` (content.js:24)
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

### Message Handling
- Use Chrome Runtime messaging for component communication
- Implement proper async response handling
- Include error responses for all message types

## Important Implementation Details

### File Transfer Architecture
- **Memory Caching**: Files cached in `popup.js` using `preloadedFiles` Map (popup.js:19)
- **On-Demand Transfer**: Content script requests files via `FLOW_BATCH_REQUEST_FILE` message (popup.js:120-122)
- **File Format**: Files transmitted as base64-encoded Data URLs
- **No Persistent Storage**: Files only in memory - Chrome Storage only stores metadata
- **Cache Lifecycle**: File cache cleared when new queue starts (content.js:180-181)

### UI State Persistence
- **Persistent Data**: Prompts, flow mode, crop mode, file metadata
- **Storage Key**: `flowBatchUIState` in Chrome Storage Local (popup.js:146)
- **Auto-Save**: Triggers on input changes (`saveUIState` - popup.js:69-70, 76-77)
- **Auto-Restore**: Loads on popup initialization (`restoreUIState` - popup.js:172-197)
- **File Limitation**: Cannot restore actual File objects, only metadata

### Queue Management Strategy
- **Atomic Updates**: Uses `_updatingState` lock to prevent race conditions (content.js:35)
- **Rate Limiting**: Throttled to respect Google Labs limits (60s post-submission delay)
- **Capacity Management**: Intelligent waiting when queue capacity is full (max 4 concurrent)
- **Auto-Recovery**: State restoration after page refresh via `initializeAutoResume()` (content.js:37)
- **Force Clear**: User can force-clear stuck queues (content.js:119-177)

### CSV Import Format Support
Supports three CSV format variations:
1. **Single Column** (no header):
   ```
   美丽的日落风景
   繁华的城市夜景
   ```
2. **With Header**:
   ```
   prompt
   美丽的日落风景
   繁华的城市夜景
   ```
3. **Multi-Column** (auto-detects 'prompt' column):
   ```
   prompt,category,mood
   美丽的日落风景,自然,宁静
   繁华的城市夜景,城市,热闹
   ```

### DOM Interaction Approach
- **XPath Selectors**: Primary method for robust element identification
- **MutationObserver**: Monitors dynamic content detection
- **Polling Fallback**: Used when MutationObserver insufficient
- **Element Wait**: Configurable intervals via `ELEMENT_WAIT_INTERVAL` (content.js:24)

### Performance Optimizations
- **Memory Caching**: Files and processed data cached in memory
- **Batched Operations**: Reduces Chrome Storage API writes
- **Intelligent Delays**: Timing optimizations to avoid overwhelming target website
- **Log Throttling**: Reduces log spam via `QUEUE_STATUS_LOG_INTERVAL` (content.js:18)

## Browser Compatibility

- **Chrome Version**: 88+ (Manifest V3 requirement)
- **Target Platform**: Google Labs Flow (labs.google/fx/tools/flow)
- **Permissions**: storage, downloads, scripting, activeTab
- **Host Permissions**: https://labs.google/*

## Message Communication Protocol

### Message Types (Chrome Runtime Messaging)

**Popup → Content Script**:
- `PING` - Check content script availability
- `FLOW_BATCH_START` - Start queue with metadata
- `FLOW_BATCH_PAUSE` - Pause running queue
- `FLOW_BATCH_CLEAR` - Clear queue and reset state
- `FLOW_BATCH_OPEN_PANEL` - Open floating control panel

**Content Script → Popup**:
- `FLOW_BATCH_STATUS_UPDATE` - Queue status changes (progress, counts, state)
- `FLOW_BATCH_LOG_ENTRY` - Log messages for popup display
- `FLOW_BATCH_REQUEST_FILE` - Request file by index from popup cache

**Content Script → Background**:
- `FLOW_BATCH_DOWNLOAD` - Auto-download video after generation
- `downloadVideo` (action) - Batch download video request

**Launcher → Content Script**:
- `FLOW_BATCH_OPEN_PANEL` - Open control panel on Flow page

### Chrome Storage Keys

**Storage Keys Used**:
- `flowBatchQueueState` - Current queue state (progress, status, counts)
- `flowBatchTaskMetadata` - Task configuration metadata
- `flowBatchUIState` - UI state persistence (prompts, mode, crop settings)

**Storage Data Limits**:
- Metadata only (< 1KB per key)
- Files NOT stored (memory only via `preloadedFiles` Map)

## Key Functions Reference

### Content Script (`content.js`)
- `handleStartQueue(metadata)` - Initialize and start queue processing (119-213)
- `handlePauseQueue()` - Pause queue execution (91-93)
- `handleClearQueue()` - Clear queue and reset state (95-97)
- `processNextTask()` - Core task processing loop
- `switchToMode(modeName)` - Mode switching automation
- `updateQueueState(updates)` - Atomic state updates with lock
- `initializeAutoResume()` - Auto-recovery on page refresh (37)
- `injectFloatingWidget()` - Inject control panel UI (38)
- `initBatchDownloader()` - Initialize batch download feature (39)

### Popup Script (`popup.js`)
- `handleFileRequest(fileIndex, sendResponse)` - Transfer files to content script (120-122)
- `saveUIState()` - Persist UI state to storage (69-70, 76-77)
- `restoreUIState(uiState)` - Restore UI state on load (172-197)
- `handleStatusUpdate(data)` - Update UI from content script status
- `addLogEntry(message, type)` - Add log message to display
- `updatePreview()` - Update task preview table

### Background Script (`background.js`)
- `sanitizeFilename(name)` - Safe filename sanitization (88-93)
- Message handlers for download requests (7-86)

### Launcher Script (`launcher.js`)
- `detectActiveTab()` - Detect if current tab is Flow page (36-48)
- `updateStatus(detected, tabUrl)` - Update launcher UI status (14-34)