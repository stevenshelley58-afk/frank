(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  const business = clean(params.get("business"), 80) || "North & Co.";
  const promise = clean(params.get("promise"), 180) || "Tell us what you need and we will get back to you today.";
  const reply = clean(params.get("reply"), 220) || "Thanks for getting in touch. We have your details and will reply shortly.";
  const look = clean(params.get("look"), 40).toLowerCase();

  document.title = `${business} - website preview`;
  document.getElementById("site-name").textContent = business;
  document.getElementById("footer-name").textContent = business;
  document.getElementById("site-promise").textContent = promise;
  document.body.dataset.look = look.includes("bold") ? "bold" : look.includes("calm") ? "calm" : "warm";

  document.getElementById("site-enquiry-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = clean(new FormData(form).get("name"), 80) || "there";
    const button = form.querySelector("button");
    button.disabled = true;
    button.textContent = "Enquiry sent";
    document.getElementById("form-result").textContent = `${reply} Thanks, ${name}.`;
  });

  function clean(value, limit) {
    return String(value || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, limit);
  }
}());
