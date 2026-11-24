/**
 * Microphone input for the phone layout: the Microphone button in the input bar records audio
 * and puts it into the input as a 16 kHz mono 16-bit PCM WAV file, the same on Android and iOS,
 * ready for Speech-to-Text (ADR 0002).
 *
 * Audio comes from getUserMedia with the phone's voice processing (echo cancellation, noise
 * suppression, automatic gain) turned off: it warbles speech, and Speech-to-Text works best on
 * unprocessed audio. MediaRecorder records it natively; on Stop the recording is decoded into a
 * 16 kHz OfflineAudioContext (which resamples it), mixed to mono and written as a RIFF/WAVE file.
 * Browsers without MediaRecorder fall back to an AudioWorklet that copies the raw samples, which
 * runs in real time and can glitch on a busy phone.
 * Design: docs/MobileUI.md, docs/adr/0002-captured-audio-as-wav-photos-shrunk.md
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

export const WAV_SAMPLE_RATE = 16000;

/**
 * The AudioWorklet processor: posts a mono copy of each block of input samples. It is loaded
 * from a blob: URL, which the page's CSP allows in script-src.
 */
const RECORDER_WORKLET = `
class CccRecorder extends AudioWorkletProcessor {
    process(inputs) {
        const input = inputs[0];
        if (input && input.length) {
            const mono = new Float32Array(input[0].length);
            for (const channel of input) {
                for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / input.length;
            }
            this.port.postMessage(mono, [mono.buffer]);
        }
        return true;
    }
}
registerProcessor("ccc-recorder", CccRecorder);
`;

/**
 * Records from the microphone and puts the recording into the input.
 */
class PhoneMicrophone {

    /**
     * PhoneMicrophone constructor.
     *
     * @param {App} app - The main view object for CyberChef.
     * @param {PhoneLayout} layout - The phone layout: its sheets, and its input bar's loadFiles().
     */
    constructor(app, layout) {
        this.app = app;
        this.layout = layout;
        this.session = null;
    }


    /**
     * Sets up the Microphone button and the recorder sheet.
     */
    setup() {
        this.sheet = document.getElementById("phone-recorder-sheet");
        document.getElementById("phone-input-mic").addEventListener("click", () => this.start());
        // Stop keeps the recording; Cancel, Back, tapping outside or swiping down discards it
        document.getElementById("phone-recorder-stop").addEventListener("click", () => this.stop(true));
        document.getElementById("phone-recorder-cancel").addEventListener("click", () => this.stop(false));
        // Leaving the page or the app ends the recording and releases the microphone
        window.addEventListener("pagehide", () => this.stop(false));
        document.addEventListener("visibilitychange", () => {
            if (document.hidden && this.session) this.stop(true);
        });
    }


    /**
     * Whether a recording is in progress.
     *
     * @returns {boolean}
     */
    isRecording() {
        return Boolean(this.session);
    }


    /**
     * Starts recording, after checking the browser can.
     */
    async start() {
        if (this.session) return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this.app.alert("This browser cannot record audio here. Recording needs a secure (https) page.", 6000);
            return;
        }
        const useRecorder = Boolean(window.MediaRecorder);
        if (!useRecorder && !window.AudioWorkletNode) {
            this.app.alert("This browser cannot record audio: it has neither MediaRecorder nor AudioWorklet support.", 6000);
            return;
        }

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false}
            });
        } catch (err) {
            this.app.alert(PhoneMicrophone.errorMessage(err), 8000);
            return;
        }

        const session = {stream, chunks: [], length: 0, keep: false, started: Date.now()};
        this.session = session;
        if (useRecorder) {
            try {
                session.recorder = new MediaRecorder(stream);
                session.blobs = [];
                session.recorder.ondataavailable = e => {
                    if (e.data && e.data.size) session.blobs.push(e.data);
                };
                session.stopped = new Promise(resolve => {
                    session.recorder.onstop = resolve;
                });
                session.recorder.start(1000);
            } catch (err) {
                this.release(session);
                this.session = null;
                this.app.alert(`Recording could not start: ${err.message}`, 6000);
                return;
            }
            this.showTimer(session);
            this.layout.sheets.open(this.sheet, {onClose: () => this.finish(session)});
            return;
        }
        try {
            const context = new AudioContext();
            session.context = context;
            const url = URL.createObjectURL(new Blob([RECORDER_WORKLET], {type: "text/javascript"}));
            try {
                await context.audioWorklet.addModule(url);
            } finally {
                URL.revokeObjectURL(url);
            }
            if (this.session !== session) return; // Cancelled while starting

            const source = context.createMediaStreamSource(stream);
            const node = new AudioWorkletNode(context, "ccc-recorder");
            node.port.onmessage = e => {
                session.chunks.push(e.data);
                session.length += e.data.length;
            };
            // A node only runs while connected towards the output; a silent gain keeps it quiet
            const mute = context.createGain();
            mute.gain.value = 0;
            source.connect(node);
            node.connect(mute);
            mute.connect(context.destination);
            session.source = source;
            session.node = node;
        } catch (err) {
            this.release(session);
            this.session = null;
            this.app.alert(`Recording could not start: ${err.message}`, 6000);
            return;
        }

        this.showTimer(session);
        this.layout.sheets.open(this.sheet, {onClose: () => this.finish(session)});
    }


    /**
     * Ends the recording by closing the recorder sheet; the sheet's onClose does the work.
     *
     * @param {boolean} keep - Whether to put the recording into the input
     */
    stop(keep) {
        const session = this.session;
        if (!session) return;
        session.keep = keep;
        if (this.layout.sheets.stack.some(entry => entry.sheet === this.sheet)) {
            this.layout.sheets.close();
        } else {
            this.finish(session);
        }
    }


    /**
     * Releases the microphone and, if the recording is kept, loads it into the input.
     *
     * @param {Object} session
     */
    async finish(session) {
        if (this.session !== session) return;
        this.session = null;
        clearInterval(session.timer);

        if (session.recorder) {
            if (session.recorder.state !== "inactive") session.recorder.stop();
            await session.stopped;
            this.release(session);
            if (!session.keep) return;
            try {
                const blob = new Blob(session.blobs, {type: session.recorder.mimeType});
                if (!blob.size) {
                    this.app.alert("Nothing was recorded.", 4000);
                    return;
                }
                const pcm = await PhoneMicrophone.decodeToMono(await blob.arrayBuffer(), WAV_SAMPLE_RATE);
                this.save(pcm);
            } catch (err) {
                this.app.alert(`The recording could not be saved: ${err.message}`, 6000);
            }
            return;
        }

        const sampleRate = session.context ? session.context.sampleRate : 0;
        this.release(session);

        if (!session.keep) return;
        if (!session.length) {
            this.app.alert("Nothing was recorded.", 4000);
            return;
        }
        try {
            const samples = PhoneMicrophone.join(session.chunks, session.length);
            this.save(await PhoneMicrophone.resample(samples, sampleRate, WAV_SAMPLE_RATE));
        } catch (err) {
            this.app.alert(`The recording could not be saved: ${err.message}`, 6000);
        }
    }


    /**
     * Writes 16 kHz mono samples as a WAV file and puts it into the input.
     *
     * @param {Float32Array} pcm
     */
    save(pcm) {
        const wav = PhoneMicrophone.encodeWav(pcm, WAV_SAMPLE_RATE);
        const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
        this.layout.input.loadFiles([new File([wav], `recording-${stamp}.wav`, {type: "audio/wav"})]);
    }


    /**
     * Decodes a compressed recording (WebM/Opus, MP4/AAC) at the given sample rate and mixes it
     * to mono. decodeAudioData resamples to its context's rate.
     *
     * @param {ArrayBuffer} data
     * @param {number} sampleRate
     * @returns {Promise<Float32Array>}
     */
    static async decodeToMono(data, sampleRate) {
        const context = new OfflineAudioContext(1, 1, sampleRate);
        const decoded = await context.decodeAudioData(data);
        const mono = new Float32Array(decoded.length);
        for (let c = 0; c < decoded.numberOfChannels; c++) {
            const channel = decoded.getChannelData(c);
            for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / decoded.numberOfChannels;
        }
        return mono;
    }


    /**
     * Stops the microphone and the audio graph.
     *
     * @param {Object} session
     */
    release(session) {
        session.stream.getTracks().forEach(track => track.stop());
        if (session.recorder && session.recorder.state !== "inactive") session.recorder.stop();
        if (session.source) session.source.disconnect();
        if (session.node) session.node.port.onmessage = null;
        if (session.context && session.context.state !== "closed") session.context.close();
    }


    /**
     * Shows the running time in the recorder sheet.
     *
     * @param {Object} session
     */
    showTimer(session) {
        const el = document.getElementById("phone-recorder-time");
        const tick = () => {
            const s = Math.floor((Date.now() - session.started) / 1000);
            el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
        };
        tick();
        session.timer = setInterval(tick, 250);
    }


    /**
     * A readable message for a getUserMedia error.
     *
     * @param {Error} err
     * @returns {string}
     */
    static errorMessage(err) {
        switch (err.name) {
            case "NotAllowedError":
            case "SecurityError":
                return "Microphone access was refused. Allow the microphone for this site in the browser's " +
                    "site settings (the icon by the address), then try again.";
            case "NotFoundError":
            case "OverconstrainedError":
                return "No microphone was found.";
            case "NotReadableError":
                return "The microphone is in use by another app, or could not be started.";
            default:
                return `The microphone could not be used: ${err.message}`;
        }
    }


    /**
     * Joins recorded blocks into one array.
     *
     * @param {Float32Array[]} chunks
     * @param {number} length - Total number of samples
     * @returns {Float32Array}
     */
    static join(chunks, length) {
        const out = new Float32Array(length);
        let offset = 0;
        chunks.forEach(chunk => {
            out.set(chunk, offset);
            offset += chunk.length;
        });
        return out;
    }


    /**
     * Resamples mono audio with the browser's resampler.
     *
     * @param {Float32Array} samples
     * @param {number} fromRate
     * @param {number} toRate
     * @returns {Promise<Float32Array>}
     */
    static async resample(samples, fromRate, toRate) {
        if (fromRate === toRate) return samples;
        const frames = Math.max(1, Math.round(samples.length * toRate / fromRate));
        const offline = new OfflineAudioContext(1, frames, toRate);
        const buffer = offline.createBuffer(1, samples.length, fromRate);
        buffer.copyToChannel(samples, 0);
        const source = offline.createBufferSource();
        source.buffer = buffer;
        source.connect(offline.destination);
        source.start();
        const rendered = await offline.startRendering();
        return rendered.getChannelData(0);
    }


    /**
     * Writes mono samples as a 16-bit PCM WAV (RIFF) file.
     *
     * @param {Float32Array} samples - Values from -1 to 1
     * @param {number} sampleRate
     * @returns {ArrayBuffer}
     */
    static encodeWav(samples, sampleRate) {
        const dataSize = samples.length * 2;
        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);
        const text = (offset, str) => {
            for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
        };

        text(0, "RIFF");
        view.setUint32(4, 36 + dataSize, true);
        text(8, "WAVE");
        text(12, "fmt ");
        view.setUint32(16, 16, true);              // fmt chunk size
        view.setUint16(20, 1, true);               // PCM
        view.setUint16(22, 1, true);               // mono
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);  // byte rate
        view.setUint16(32, 2, true);               // block align
        view.setUint16(34, 16, true);              // bits per sample
        text(36, "data");
        view.setUint32(40, dataSize, true);

        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        }
        return buffer;
    }

}

export default PhoneMicrophone;
