/**
 * Camera input for the phone layout: the Camera button in the input bar opens the phone's
 * camera, and the photo becomes a file in the input.
 *
 * By default the photo is drawn to a canvas with its long edge at most 2048px and re-encoded
 * as JPEG, which drops all EXIF data, including GPS location (ADR 0002). The cameraPhotoSize
 * option chooses 2048, 4096 or the original file.
 * Design: docs/MobileUI.md, docs/adr/0002-captured-audio-as-wav-photos-shrunk.md
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

const JPEG_QUALITY = 0.9;

/**
 * Takes photos with the phone's camera and puts them into the input.
 */
class PhoneCamera {

    /**
     * PhoneCamera constructor.
     *
     * @param {App} app - The main view object for CyberChef.
     * @param {PhoneLayout} layout - The phone layout; its input bar's loadFiles() puts files into the input.
     */
    constructor(app, layout) {
        this.app = app;
        this.layout = layout;
    }


    /**
     * Sets up the Camera button.
     */
    setup() {
        const fileInput = document.getElementById("phone-camera-file");
        document.getElementById("phone-input-camera").addEventListener("click", () => fileInput.click());
        fileInput.addEventListener("change", async () => {
            const file = fileInput.files[0];
            fileInput.value = "";
            if (file) await this.useFile(file);
        });
    }


    /**
     * Prepares a captured photo according to the cameraPhotoSize option and loads it.
     *
     * @param {File} file - The photo from the camera
     */
    async useFile(file) {
        const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
        try {
            let photo;
            if (this.app.options.cameraPhotoSize === "original") {
                const ext = (file.name.match(/\.[^.]+$/) || [".jpg"])[0].toLowerCase();
                photo = new File([file], `photo-${stamp}${ext}`, {type: file.type});
            } else {
                const limit = parseInt(this.app.options.cameraPhotoSize, 10) || 2048;
                const blob = await PhoneCamera.shrink(file, limit);
                photo = new File([blob], `photo-${stamp}.jpg`, {type: "image/jpeg"});
            }
            this.layout.input.loadFiles([photo]);
        } catch (err) {
            this.app.alert(`The photo could not be used: ${err.message}`, 5000);
        }
    }


    /**
     * Draws an image no larger than `limit` pixels on its long edge and encodes it as JPEG.
     * Re-encoding drops EXIF data; the EXIF orientation is applied first so the photo stays upright.
     * Images already smaller than the limit are re-encoded but not enlarged.
     *
     * @param {Blob} file
     * @param {number} limit - The maximum long edge, in pixels
     * @returns {Promise<Blob>}
     */
    static async shrink(file, limit) {
        let bitmap;
        try {
            bitmap = await createImageBitmap(file, {imageOrientation: "from-image"});
        } catch (err) {
            throw new Error("this file is not an image the browser can read.");
        }
        const scale = Math.min(1, limit / Math.max(bitmap.width, bitmap.height));
        const width = Math.round(bitmap.width * scale);
        const height = Math.round(bitmap.height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
        bitmap.close();

        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
        if (!blob) throw new Error("the photo could not be encoded as JPEG.");
        return blob;
    }

}

export default PhoneCamera;
