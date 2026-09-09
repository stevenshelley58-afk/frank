import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRect, normalizedToPixels, pointerToNormalized, safeAnnotationText, serializeAnnotations } from "../web/js/ad-review-annotations.js";
test("normalizes reverse and out-of-bounds rectangles", () => assert.deepEqual(normalizeRect({ x: 1.2, y: .8 }, { x: -.2, y: -.1 }), { x: 0, y: 0, width: 1, height: .8 }));
test("maps pointer using displayed image, not letterbox frame", () => assert.deepEqual(pointerToNormalized({ clientX: 300, clientY: 250 }, { left: 0, top: 0, width: 1000, height: 600 }, { left: 100, top: 50, width: 400, height: 400 }), { x: .5, y: .5 }));
test("keeps normalized geometry stable at any zoom", () => assert.deepEqual(normalizedToPixels({ x: .1, y: .2, width: .5, height: .25 }, 800, 400), { left: 80, top: 80, width: 400, height: 100 }));
test("sanitizes text and drops tiny boxes", () => { assert.equal(safeAnnotationText(" <script>\n hello"), "<script> hello"); assert.deepEqual(serializeAnnotations([{ x: .1, y: .1, width: .5, height: .4, comment: "ok" }, { x: 0, y: 0, width: .001, height: .2 }]).length, 1); });