---
status: accepted
---

# Captured audio is 16 kHz mono WAV; camera photos are shrunk and stripped by default

**Captured input** from the phone is converted to a fixed form before it reaches the input.

**Microphone recordings** are captured as PCM and saved as **16 kHz mono WAV**. We don't keep the browser's native `MediaRecorder` format. Chrome records webm/opus and Safari records mp4/aac, and the Speech-to-Text API does not reliably accept mp4/aac. WAV gives the same file on every phone. Every Speech API version accepts it. It is small enough to send inline (about 1.9 MB a minute).

**Camera photos** are scaled to a 2048px long edge and re-encoded as JPEG by default. This keeps them under the inline size limits of the Vision API, which the base64 encoding of a full-size phone photo can exceed. It is also quicker to upload over mobile data. Re-encoding removes EXIF metadata, including GPS location, so a photo's location is not sent to a cloud service by accident. An Options setting ("Camera photo size: 2048px / 4096px / Original") keeps the original file for users who need its metadata. Uploading the file also keeps the original.
