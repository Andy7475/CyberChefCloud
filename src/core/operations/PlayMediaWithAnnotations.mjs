/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import Utils from "../Utils.mjs";
import { toBase64 } from "../lib/Base64.mjs";

/**
 * Parses a string offset returning a float of seconds
 * @param {string} offsetStr - Offset string like "1.5s"
 * @returns {number} Float representation of seconds
 */
function parseOffset(offsetStr) {
    if (!offsetStr) return 0;
    return parseFloat(offsetStr.replace("s", ""));
}

/**
 * Formats a float of seconds into WebVTT timestamp
 * @param {number} secondsFloat - Float representation of seconds
 * @returns {string} Timestamp string "HH:MM:SS.mmm"
 */
function formatVttTime(secondsFloat) {
    const h = Math.floor(secondsFloat / 3600);
    const m = Math.floor((secondsFloat % 3600) / 60);
    const s = Math.floor(secondsFloat % 60);
    const ms = Math.round((secondsFloat - Math.floor(secondsFloat)) * 1000);
    const pad = (num, len) => String(num).padStart(len, "0");
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
}

/**
 * Play Media with Annotations operation
 */
class PlayMediaWithAnnotations extends Operation {

    /**
     * PlayMediaWithAnnotations constructor
     */
    constructor() {
        super();

        this.name = "Play Media with Annotations";
        this.module = "Default";
        this.description = "Takes JSON output from GCloud Video Intelligence and plays the media with chapter markers and a clickable annotation list.";
        this.infoURL = "";
        this.inputType = "JSON";
        this.outputType = "JSON";
        this.presentType = "html";
        this.args = [];
    }

    /**
     * @param {JSON} input
     * @param {Object[]} args
     * @returns {JSON}
     */
    run(input, args) {
        if (!input || !input.annotations) {
            throw new OperationError("Input does not appear to be valid JSON from GCloud Video Intelligence.");
        }
        return input;
    }

    /**
     * Displays a media player with annotations.
     *
     * @param {JSON} data JSON containing an audio or video file and annotations.
     * @returns {string} Markup to display a media player and annotations.
     */
    async present(data) {
        if (!data || (!data.media && !data.originalUri)) return "No media data or GCS URI found in JSON to play.";

        let mediaUri = "";
        if (data.media) {
            mediaUri = `data:${data.mimeType || "video/mp4"};base64,${data.media}`;
        } else if (data.originalUri && data.originalUri.startsWith("gs://")) {
            try {
                const { applyGCPAuth } = await import("../lib/GoogleCloud.mjs");
                const match = data.originalUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
                if (match) {
                    const encodedObject = encodeURIComponent(match[2]).replace(/%2F/g, "%2F");
                    const fetchUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(match[1])}/o/${encodedObject}?alt=media`;
                    const auth = applyGCPAuth(fetchUrl, new Headers());
                    const resp = await fetch(auth.url, { headers: auth.headers });
                    if (resp.ok) {
                        const blob = await resp.blob();
                        mediaUri = URL.createObjectURL(blob);
                    } else {
                        return `Failed to fetch GCS media on-the-fly: ${resp.status} ${resp.statusText}`;
                    }
                }
            } catch (e) {
                return "Failed to proxy stream from GCS: " + e.message;
            }
        }

        // Extract and flatten annotations
        const events = [];
        const ann = data.annotations || {};

        events.push({
            title: "Start",
            start: 0,
            end: 0
        });
        // 1. Person Detection
        if (ann.personDetectionAnnotations) {
            ann.personDetectionAnnotations.forEach((person, i) => {
                person.tracks?.forEach(track => {
                    if (track.segment) {
                        events.push({
                            title: `Person ${i+1}`,
                            start: parseOffset(track.segment.startTimeOffset),
                            end: parseOffset(track.segment.endTimeOffset)
                        });
                    }
                });
            });
        }

        // 2. Explicit Content
        if (ann.explicitAnnotation && ann.explicitAnnotation.frames) {
            ann.explicitAnnotation.frames.forEach(frame => {
                if (frame.pornographyLikelihood === "LIKELY" || frame.pornographyLikelihood === "VERY_LIKELY") {
                    const t = parseOffset(frame.timeOffset);
                    events.push({
                        title: `Explicit Content (${frame.pornographyLikelihood})`,
                        start: t,
                        end: t + 2 // Highlight 2s window
                    });
                }
            });
        }

        // 3. Label Detection
        if (ann.segmentLabelAnnotations) {
            ann.segmentLabelAnnotations.forEach(label => {
                label.segments?.forEach(seg => {
                    events.push({
                        title: `Label: ${label.entity?.description || "Unknown"}`,
                        start: parseOffset(seg.segment.startTimeOffset),
                        end: parseOffset(seg.segment.endTimeOffset)
                    });
                });
            });
        }

        // 4. Shot Changes
        if (ann.shotAnnotations) {
            ann.shotAnnotations.forEach((shot, i) => {
                events.push({
                    title: `Shot ${i+1}`,
                    start: parseOffset(shot.startTimeOffset),
                    end: parseOffset(shot.endTimeOffset)
                });
            });
        }

        events.sort((a, b) => a.start - b.start);

        // Generate VTT
        let vtt = "WEBVTT\n\n";
        events.forEach((ev, i) => {
            vtt += `${i+1}\n`;
            vtt += `${formatVttTime(ev.start)} --> ${formatVttTime(ev.end)}\n`;
            vtt += `${ev.title}\n\n`;
        });

        const vttBase64 = toBase64(Utils.strToByteArray(vtt));
        const vttUri = `data:text/vtt;base64,${vttBase64}`;

        const playerId = "vid-" + Math.random().toString(36).substring(2, 9);

        // Build options
        let optionsHtml = "";
        if (events.length === 0) {
            optionsHtml = `<option value="0">No annotations found</option>`;
        } else {
            events.forEach(ev => {
                optionsHtml += `<option value="${ev.start}">${formatVttTime(ev.start).substring(3, 8)} - ${ev.title}</option>`;
            });
        }

        // HTML builder
        const html = `
        <div style="display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 400px; gap: 10px;">
            <div style="display: flex; gap: 10px; align-items: center; background: rgba(0,0,0,0.05); padding: 10px; border-radius: 5px;">
                <span style="font-weight: bold; white-space: nowrap;">Annotations:</span>
                <button class="btn btn-secondary btn-sm" style="margin: 0;" onclick="var s = document.getElementById('sel-${playerId}'); if (s.selectedIndex > 0) { s.selectedIndex--; s.onchange(); }">Prev</button>
                <select id="sel-${playerId}" class="form-control" style="flex: 1; min-width: 0;" onchange="var v = document.getElementById('${playerId}'); v.currentTime = parseFloat(this.value); v.play();">
                    ${optionsHtml}
                </select>
                <button class="btn btn-secondary btn-sm" style="margin: 0;" onclick="var s = document.getElementById('sel-${playerId}'); if (s.selectedIndex < s.options.length - 1) { s.selectedIndex++; s.onchange(); }">Next</button>
            </div>
            <video id="${playerId}" src="${mediaUri}" type="${data.mimeType || "video/mp4"}" controls style="width: 100%; max-height: 60vh; object-fit: contain;">
                <track kind="chapters" src="${vttUri}" srclang="en" default>
                <p>Unsupported media type.</p>
            </video>
        </div>`;

        return html;
    }
}

export default PlayMediaWithAnnotations;
