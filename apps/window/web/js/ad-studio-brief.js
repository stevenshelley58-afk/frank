export const AD_STUDIO_BRIEF_MAX_CHARACTERS = 4000;

export function adStudioBriefLength(value) {
  return Array.from(typeof value === "string" ? value : "").length;
}

export function adStudioBriefValidation(value) {
  if (typeof value !== "string") {
    return { valid: false, length: 0, message: "The generator brief must be text." };
  }
  const length = adStudioBriefLength(value);
  return length <= AD_STUDIO_BRIEF_MAX_CHARACTERS
    ? { valid: true, length, message: "" }
    : {
      valid: false,
      length,
      message: `Brief is ${length.toLocaleString("en-AU")} characters. Keep it to 4,000 or fewer; Frank did not shorten it.`,
    };
}
