// ==UserScript==
// @name         YouTube to Obsidian with Transcript
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Extract YouTube data, transcript, and save as Markdown to Obsidian
// @author       You
// @match        https://www.youtube.com/watch*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      youtube.com
// ==/UserScript==

(function() {
    'use strict';

    // --- CSS Styles for UI ---
    GM_addStyle(`
        #yto-obsidian-btn {
            background-color: #cc0000;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 18px;
            font-weight: bold;
            cursor: pointer;
            font-family: "Roboto", "Arial", sans-serif;
            font-size: 14px;
            margin-left: 8px;
            display: inline-flex;
            align-items: center;
            transition: background 0.2s;
        }
        #yto-obsidian-btn:hover {
            background-color: #ff0000;
        }
        #yto-modal-overlay {
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.7);
            z-index: 9999;
            display: none;
            justify-content: center;
            align-items: center;
        }
        #yto-modal {
            background: #212121;
            color: #fff;
            width: 500px;
            max-width: 90%;
            padding: 24px;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            font-family: "Roboto", "Arial", sans-serif;
            display: flex;
            flex-direction: column;
            gap: 15px;
        }
        #yto-modal h2 { margin-top: 0; font-size: 20px; color: #fff; }
        #yto-modal label { font-size: 14px; color: #aaa; }
        #yto-modal textarea {
            width: 100%;
            height: 150px;
            background: #333;
            border: 1px solid #555;
            color: #fff;
            padding: 10px;
            border-radius: 4px;
            resize: vertical;
            font-family: inherit;
        }
        #yto-modal .row { display: flex; justify-content: space-between; align-items: center; }
        #yto-modal .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px; }
        #yto-modal button {
            padding: 8px 16px;
            border-radius: 4px;
            border: none;
            cursor: pointer;
            font-weight: bold;
        }
        #yto-btn-cancel { background: #444; color: #fff; }
        #yto-btn-save { background: #3ea6ff; color: #000; }
        #yto-btn-save:disabled { background: #555; color: #888; cursor: not-allowed; }
        .yto-loading { opacity: 0.5; pointer-events: none; }
    `);

    // --- Data Extractor Class ---
    class YouTubeDataExtractor {
        getVideoId() {
            const urlParams = new URLSearchParams(window.location.search);
            return urlParams.get('v');
        }

        async waitForElements() {
            return new Promise((resolve) => {
                const maxWaitTime = 3000;
                const startTime = Date.now();
                const check = () => {
                    const title = this.extractTitle();
                    const channel = this.extractChannel();
                    if (title && channel && title !== 'Unknown Title' && channel !== 'Unknown Channel') {
                        resolve();
                    } else if (Date.now() - startTime > maxWaitTime) {
                        resolve();
                    } else {
                        setTimeout(check, 100);
                    }
                };
                check();
            });
        }

        extractTitle() {
            const selectors = [
                'h1.ytd-watch-metadata yt-formatted-string',
                'h1 yt-formatted-string',
                '#title h1',
                'ytd-watch-metadata h1'
            ];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el && el.textContent.trim()) return el.textContent.trim();
            }
            return 'Unknown Title';
        }

        extractChannel() {
            const selectors = [
                '#owner #channel-name a',
                '#channel-name a',
                '.ytd-channel-name a',
                'ytd-video-owner-renderer a'
            ];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el && el.textContent.trim()) return el.textContent.trim();
            }
            return 'Unknown Channel';
        }

        extractDescription() {
            const selectors = [
                '#description yt-formatted-string',
                '#description-text',
                'ytd-text-inline-expander yt-formatted-string'
            ];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el && el.textContent.trim()) {
                    const txt = el.textContent.trim();
                    return txt.length > 500 ? txt.substring(0, 500) + '...' : txt;
                }
            }
            return '';
        }
    }

    // --- Transcript Extractor (Adapted from Extension Code) ---
    class TranscriptExtractor {
        constructor() {
            this.captionTracks = null;
        }

        // Extract caption track URL from page data
        extractCaptionTrackUrl() {
            try {
                // Method 1: Look for caption tracks in player response
                const scripts = document.querySelectorAll('script');
                for (const script of scripts) {
                    const text = script.textContent || '';
                    if (text.includes('captionTracks')) {
                        const match = text.match(/"captionTracks":(\[.*?\])/);
                        if (match) {
                            const tracks = JSON.parse(match[1]);
                            if (tracks && tracks.length > 0) {
                                // Prefer English, otherwise take first available
                                const englishTrack = tracks.find(t => t.languageCode === 'en');
                                return (englishTrack || tracks[0]).baseUrl;
                            }
                        }
                    }
                }

                // Method 2: Look in ytInitialPlayerResponse
                if (window.ytInitialPlayerResponse) {
                    const tracks = window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                    if (tracks && tracks.length > 0) {
                        const englishTrack = tracks.find(t => t.languageCode === 'en');
                        return (englishTrack || tracks[0]).baseUrl;
                    }
                }

                // Method 3: Look in ytInitialData
                if (window.ytInitialData) {
                    const tracks = window.ytInitialData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                    if (tracks && tracks.length > 0) {
                        const englishTrack = tracks.find(t => t.languageCode === 'en');
                        return (englishTrack || tracks[0]).baseUrl;
                    }
                }
            } catch (e) {
                console.log('TranscriptExtractor: Failed to extract caption URL', e);
            }
            return null;
        }

        // Fetch transcript from YouTube API
        async fetchTranscript(videoId) {
            return new Promise((resolve) => {
                // First, try to get the caption track URL from the page
                let captionUrl = this.extractCaptionTrackUrl();

                if (!captionUrl) {
                    // Fallback: construct URL manually
                    captionUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`;
                }

                // Add fmt=json3 if not present
                if (!captionUrl.includes('fmt=')) {
                    captionUrl += '&fmt=json3';
                }

                GM_xmlhttpRequest({
                    method: "GET",
                    url: captionUrl,
                    onload: (response) => {
                        if (response.status === 200 && response.responseText) {
                            try {
                                const data = JSON.parse(response.responseText);
                                if (data.events && data.events.length > 0) {
                                    // Parse JSON3 format
                                    const transcript = data.events
                                        .filter(e => e.segs)
                                        .map(e => e.segs.map(s => s.utf8).join(''))
                                        .join(' ');
                                    resolve(transcript.trim());
                                } else {
                                    resolve(null);
                                }
                            } catch (e) {
                                console.log('TranscriptExtractor: Failed to parse transcript JSON', e);
                                resolve(null);
                            }
                        } else {
                            // Try fallback language
                            if (!captionUrl.includes('lang=en')) {
                                const fallbackUrl = captionUrl.replace(/lang=[a-z-]+/, 'lang=en');
                                if (fallbackUrl !== captionUrl) {
                                    this.fetchTranscriptWithUrl(fallbackUrl).then(resolve);
                                    return;
                                }
                            }
                            resolve(null);
                        }
                    },
                    onerror: () => {
                        console.log('TranscriptExtractor: Request failed');
                        resolve(null);
                    }
                });
            });
        }

        async fetchTranscriptWithUrl(url) {
            return new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: url,
                    onload: (response) => {
                        if (response.status === 200 && response.responseText) {
                            try {
                                const data = JSON.parse(response.responseText);
                                if (data.events && data.events.length > 0) {
                                    const transcript = data.events
                                        .filter(e => e.segs)
                                        .map(e => e.segs.map(s => s.utf8).join(''))
                                        .join(' ');
                                    resolve(transcript.trim());
                                } else {
                                    resolve(null);
                                }
                            } catch (e) {
                                resolve(null);
                            }
                        } else {
                            resolve(null);
                        }
                    },
                    onerror: () => resolve(null)
                });
            });
        }

        // Alternative: Extract transcript from DOM (click "Show transcript" button)
        async extractTranscriptFromDOM() {
            return new Promise((resolve) => {
                const buttons = [
                    'button[aria-label="Show transcript"]',
                    '#button[aria-label="Show transcript"]',
                    'ytd-video-description-transcript-section-renderer #primary-button button',
                    '#primary-button > ytd-button-renderer > yt-button-shape > button'
                ];

                let transcriptButton = null;
                for (const selector of buttons) {
                    transcriptButton = document.querySelector(selector);
                    if (transcriptButton) break;
                }

                if (!transcriptButton) {
                    resolve(null);
                    return;
                }

                // Click the button to open transcript panel
                transcriptButton.click();

                // Wait for transcript segments to load
                setTimeout(() => {
                    const segments = document.querySelectorAll('#segments-container > ytd-transcript-segment-renderer');
                    if (segments.length === 0) {
                        // Try alternative selector
                        const altSegments = document.querySelectorAll('ytd-transcript-segment-renderer');
                        if (altSegments.length === 0) {
                            resolve(null);
                            return;
                        }
                    }

                    const transcriptSegments = segments.length > 0 ? segments : document.querySelectorAll('ytd-transcript-segment-renderer');
                    const transcript = Array.from(transcriptSegments)
                        .map(segment => {
                            const text = segment.querySelector('yt-formatted-string')?.textContent?.trim();
                            return text || '';
                        })
                        .filter(t => t)
                        .join(' ');

                    resolve(transcript.trim() || null);
                }, 1500);
            });
        }

        // Main method: Try API first, fallback to DOM
        async getTranscript(videoId) {
            // Try API method first
            let transcript = await this.fetchTranscript(videoId);

            if (!transcript) {
                // Fallback to DOM extraction
                console.log('TranscriptExtractor: API failed, trying DOM extraction');
                transcript = await this.extractTranscriptFromDOM();
            }

            return transcript;
        }
    }

    // --- UI Manager ---
    class UIManager {
        constructor(extractor, transcriptExtractor) {
            this.extractor = extractor;
            this.transcriptExtractor = transcriptExtractor;
            this.modal = null;
            this.initButton();
        }

        initButton() {
            const observer = new MutationObserver(() => {
                const menu = document.querySelector('#top-level-buttons-computed');
                const btn = document.getElementById('yto-obsidian-btn');
                if (menu && !btn) {
                    this.createButton(menu);
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }

        createButton(container) {
            const btn = document.createElement('button');
            btn.id = 'yto-obsidian-btn';
            btn.textContent = 'Save to Obsidian';
            btn.onclick = () => this.openModal();
            container.appendChild(btn);
        }

        openModal() {
            if (this.modal) {
                this.modal.style.display = 'flex';
                return;
            }

            const overlay = document.createElement('div');
            overlay.id = 'yto-modal-overlay';

            const modal = document.createElement('div');
            modal.id = 'yto-modal';

            const title = document.createElement('h2');
            title.textContent = 'Save to Obsidian';
            modal.appendChild(title);

            const infoDiv = document.createElement('div');
            infoDiv.id = 'yto-info';
            infoDiv.style.fontSize = '13px';
            infoDiv.style.color = '#ccc';
            modal.appendChild(infoDiv);

            const notesLabel = document.createElement('label');
            notesLabel.textContent = 'User Notes';
            modal.appendChild(notesLabel);

            const notesTextarea = document.createElement('textarea');
            notesTextarea.id = 'yto-notes';
            notesTextarea.placeholder = 'Add your personal thoughts here...';
            modal.appendChild(notesTextarea);

            const rowDiv = document.createElement('div');
            rowDiv.className = 'row';

            const checkboxLabel = document.createElement('label');
            checkboxLabel.style.display = 'flex';
            checkboxLabel.style.alignItems = 'center';
            checkboxLabel.style.gap = '5px';
            checkboxLabel.style.cursor = 'pointer';

            const transcriptCheckbox = document.createElement('input');
            transcriptCheckbox.type = 'checkbox';
            transcriptCheckbox.id = 'yto-transcript';

            const checkboxText = document.createTextNode(' Include Transcript');
            checkboxLabel.appendChild(transcriptCheckbox);
            checkboxLabel.appendChild(checkboxText);
            rowDiv.appendChild(checkboxLabel);

            const statusSpan = document.createElement('span');
            statusSpan.id = 'yto-status';
            statusSpan.style.fontSize = '12px';
            statusSpan.style.color = '#aaa';
            rowDiv.appendChild(statusSpan);

            modal.appendChild(rowDiv);

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'actions';

            const cancelBtn = document.createElement('button');
            cancelBtn.id = 'yto-btn-cancel';
            cancelBtn.textContent = 'Cancel';
            actionsDiv.appendChild(cancelBtn);

            const saveBtn = document.createElement('button');
            saveBtn.id = 'yto-btn-save';
            saveBtn.textContent = 'Save';
            actionsDiv.appendChild(saveBtn);

            modal.appendChild(actionsDiv);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            this.modal = overlay;

            const videoId = this.extractor.getVideoId();
            const videoTitle = this.extractor.extractTitle();
            const channel = this.extractor.extractChannel();
            infoDiv.textContent = `${videoTitle} by ${channel}`;

            cancelBtn.onclick = () => this.closeModal();
            saveBtn.onclick = () => this.processSave(videoId);

            overlay.onclick = (e) => {
                if (e.target === overlay) this.closeModal();
            };
        }

        closeModal() {
            if (this.modal) {
                this.modal.style.display = 'none';
            }
        }

        async processSave(videoId) {
            const saveBtn = document.getElementById('yto-btn-save');
            const statusSpan = document.getElementById('yto-status');
            const includeTranscript = document.getElementById('yto-transcript').checked;
            const userNotes = document.getElementById('yto-notes').value;

            saveBtn.disabled = true;
            saveBtn.textContent = 'Processing...';
            statusSpan.textContent = '';

            try {
                await this.extractor.waitForElements();

                const videoData = {
                    id: videoId,
                    title: this.extractor.extractTitle(),
                    channel: this.extractor.extractChannel(),
                    description: this.extractor.extractDescription(),
                    url: window.location.href,
                    timestamp: new Date().toISOString(),
                    userNotes: userNotes
                };

                let transcriptText = '';
                if (includeTranscript) {
                    statusSpan.textContent = 'Fetching transcript...';
                    transcriptText = await this.transcriptExtractor.getTranscript(videoId);
                    if (!transcriptText) {
                        statusSpan.textContent = 'Transcript not available.';
                    } else {
                        statusSpan.textContent = 'Transcript fetched!';
                    }
                }

                statusSpan.textContent = 'Generating file...';
                const markdown = this.generateMarkdown(videoData, transcriptText);
                const filename = this.generateFilename(videoData);

                statusSpan.textContent = 'Downloading...';
                this.downloadFile(markdown, filename);

                this.closeModal();
            } catch (error) {
                console.error(error);
                statusSpan.textContent = 'Error: ' + error.message;
                statusSpan.style.color = '#ff4444';
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save';
            }
        }

        generateMarkdown(data, transcript) {
            const escapeYaml = (text) => {
                if (!text) return '';
                return text.replace(/"/g, '\\"').replace(/\n/g, ' ');
            };

            const transcriptSection = transcript ? `
## Transcript
\`\`\`
${transcript}
\`\`\`
` : '';

            return `---
source: YouTube
channel: "${escapeYaml(data.channel)}"
url: ${data.url}
thumbnail: 'https://i.ytimg.com/vi/${data.id}/maxresdefault.jpg'
date_saved: "${new Date().toISOString().split('T')[0]}"
tags: [youtube]
---

## Video Embed
![](${data.url})

## Title
${data.title}

## Description
${data.description}

## User Notes
${data.userNotes || '*No notes added*'}

${transcriptSection}
---
*Saved with YouTube to Obsidian Userscript*`;
        }

        generateFilename(data) {
            const cleanTitle = data.title
                .replace(/[<>:"/\\|?*]/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 50);
            return `${cleanTitle}.md`;
        }

        downloadFile(content, filename) {
            const blob = new Blob([content], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);

            GM_download({
                url: url,
                name: filename,
                saveAs: true
            });

            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    }

    // --- Initialization ---
    function init() {
        const extractor = new YouTubeDataExtractor();
        const transcriptExtractor = new TranscriptExtractor();
        if (window.location.pathname === '/watch') {
            new UIManager(extractor, transcriptExtractor);
        }
    }

    init();

    // Handle YouTube SPA Navigation
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            if (url.includes('/watch')) {
                const existingBtn = document.getElementById('yto-obsidian-btn');
                if(existingBtn) existingBtn.remove();
                const existingModal = document.getElementById('yto-modal-overlay');
                if(existingModal) existingModal.remove();
                init();
            }
        }
    }).observe(document, { subtree: true, childList: true });

})();