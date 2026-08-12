import { getShade } from './shades.mjs';

// gemini-2.5-flash-image was measured REGENERATING the scene rather than editing
// the glass — the P0 harness showed a ~3-point luminance gap between 70% and 5%,
// i.e. no visible product. gemini-3.1-flash-image with the mask-style instruction
// below measured a ~34-point gap with the change confined to ~5% of the frame.
// Do not downgrade this default without re-running tools/render-harness.mjs.
export const DEFAULT_MODEL = 'gemini-3.1-flash-image';

// Phrased as a masked retouch, not a creative brief. Naming the mask and
// demanding byte-identity outside it is what stopped the model reimagining the
// whole photograph. Measured, not guessed — see tools/render-harness.mjs.
const BASE_INSTRUCTION = `This is a photograph of a customer's car. Retouch it the way a window-tinting shop would to preview a film install.

Mask the side windows and the rear window glass. Inside that mask ONLY, reduce the visible light transmission so the result matches the description below.

Everything outside the glass mask must be identical to the input: paint colour, panel gaps, wheels, tyres, badges, number plate, mirrors, and the entire background including ground, buildings, foliage, sky and shadows.

Do not restyle, recolour, reframe, crop, or re-light the vehicle. Do not add reflections that were not already present. Do not regenerate the scene.

Return the retouched photograph.

TINT TO APPLY:`;

export async function renderTint({ imageBase64, mime, shadeId, apiKey, model }) {
  const shade = getShade(shadeId);
  if (!shade) {
    throw new Error(`Unknown shade ID: ${shadeId}`);
  }

  const prompt = `${BASE_INSTRUCTION}\n\n${shade.prompt}`;

  const requestBody = {
    contents: [
      {
        // Image FIRST, then the instruction. With text first the model treated
        // the request as "generate a picture like this" and reimagined the
        // scene; image first it treats it as "edit this". Measured difference.
        parts: [
          { inline_data: { mime_type: mime, data: imageBase64 } },
          { text: prompt }
        ]
      }
    ]
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  let lastError;

  try {
    // Attempt up to 2 times (initial + 1 retry)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          }
        );

        if (!response.ok) {
          const status = response.status;
          const text = await response.text();
          const error = new Error(`Gemini API error ${status}: ${text}`);

          // Retry on 429, 500, 503 only on first attempt
          if ([429, 500, 503].includes(status) && attempt === 0) {
            lastError = error;
            await new Promise(resolve => setTimeout(resolve, 1500));
            continue;
          }

          throw error;
        }

        const data = await response.json();

        // Validate response structure
        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
          throw new Error('Unexpected Gemini response structure: missing candidates or content');
        }

        const parts = data.candidates[0].content.parts;
        if (!Array.isArray(parts)) {
          throw new Error('Unexpected Gemini response structure: parts is not an array');
        }

        // Find the part with image data (inlineData or inline_data)
        for (const part of parts) {
          const inline = part.inlineData || part.inline_data;
          if (inline && inline.data) {
            clearTimeout(timeoutId);
            return {
              imageBase64: inline.data,
              mime: inline.mimeType || inline.mime_type || mime
            };
          }
        }

        throw new Error('Gemini response contains no image data in parts');

      } catch (err) {
        if (err.name === 'AbortError') {
          throw new Error('Gemini API request timeout (60 seconds)');
        }
        lastError = err;
        // Only retry on retryable status codes on first attempt
        if (attempt === 0 && err.message && /error (429|500|503)/.test(err.message)) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          continue;
        }
        throw err;
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }

  // This should not be reached, but throw last error if it is
  throw lastError || new Error('Failed to render tint after retries');
}
