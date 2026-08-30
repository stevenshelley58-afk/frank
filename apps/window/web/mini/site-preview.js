(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  const business = clean(params.get("business"), 80) || "North & Co.";
  const promise = clean(params.get("promise"), 180) || "Tell us what you need and we will get back to you today.";
  const reply = clean(params.get("reply"), 220) || "Thanks for getting in touch. We have your details and will reply shortly.";
  const look = clean(params.get("look"), 40).toLowerCase();

  document.title = `${business} - website demonstration`;
  document.getElementById("site-name").textContent = business;
  document.getElementById("footer-name").textContent = business;
  document.getElementById("site-promise").textContent = promise;
  document.body.dataset.look = look.includes("bold") ? "bold" : look.includes("calm") ? "calm" : "warm";

  const demo = document.getElementById("site-enquiry-form");
  const fields = [...demo.querySelectorAll("input, textarea")];
  const acknowledgementButton = document.getElementById("show-acknowledgement");
  const resetButton = document.getElementById("reset-sample");
  const result = document.getElementById("form-result");

  fields.forEach((field) => { field.disabled = false; });
  acknowledgementButton.disabled = false;

  acknowledgementButton.addEventListener("click", () => {
    if (!fields.every((field) => field.reportValidity())) return;
    acknowledgementButton.disabled = true;
    acknowledgementButton.textContent = "Sample acknowledgement shown";
    result.textContent = "Sample acknowledgement shown. This preview used the reply above and has not sent an enquiry.";
    resetButton.hidden = false;
  });

  resetButton.addEventListener("click", () => {
    fields.forEach((field) => { field.value = ""; });
    acknowledgementButton.disabled = false;
    acknowledgementButton.textContent = "Show sample acknowledgement";
    result.textContent = "";
    resetButton.hidden = true;
  });

  function clean(value, limit) {
    return String(value || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, limit);
  }
}());
