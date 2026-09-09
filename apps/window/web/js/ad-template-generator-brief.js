export const AD_TEMPLATE_GENERATOR_BRIEF_MAX_CHARACTERS = 4000;

export function adTemplateGeneratorBriefLength(value) {
  return Array.from(typeof value === "string" ? value : "").length;
}

export function adTemplateGeneratorBriefValidation(value) {
  if (typeof value !== "string") {
    return { valid: false, length: 0, message: "The generator brief must be text." };
  }
  const length = adTemplateGeneratorBriefLength(value);
  return length <= AD_TEMPLATE_GENERATOR_BRIEF_MAX_CHARACTERS
    ? { valid: true, length, message: "" }
    : {
      valid: false,
      length,
      message: `Brief is ${length.toLocaleString("en-AU")} characters. Keep it to 4,000 or fewer; Frank did not shorten it.`,
    };
}
