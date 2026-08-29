(() => {
  "use strict";

  const HANDOFF_KEY = "frank_landing_prompt_v1";
  const problemInput = document.getElementById("problem");
  const finalInput = document.getElementById("final-problem");
  const header = document.getElementById("site-header");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const staticCapture = new URLSearchParams(window.location.search).has("static");

  window.addEventListener("scroll", () => {
    header.classList.toggle("compact", window.scrollY > 32);
  }, { passive: true });

  function beginFrank(problem) {
    const cleanProblem = String(problem || "").trim().slice(0, 4000);
    if (!cleanProblem) return false;
    try {
      window.localStorage.setItem(HANDOFF_KEY, cleanProblem);
    } catch (_) {
      // The conversation still opens if storage is unavailable.
    }
    window.location.assign("/frank/?from=landing");
    return true;
  }

  document.querySelectorAll(".starter").forEach((button) => {
    button.addEventListener("click", () => {
      problemInput.value = `I want to ${button.textContent.toLowerCase()} in my business.`;
      problemInput.focus();
    });
  });

  document.getElementById("hero-composer").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!beginFrank(problemInput.value)) problemInput.focus();
  });

  document.getElementById("final-composer").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!beginFrank(finalInput.value)) finalInput.focus();
  });

  document.querySelector("[data-continue-attach]").addEventListener("click", () => {
    const problem = problemInput.value.trim() || "I want to show Frank some files and explain what my business needs.";
    beginFrank(problem);
  });

  if (reduceMotion || staticCapture) {
    document.querySelectorAll(".reveal").forEach((item) => item.classList.add("visible"));
  } else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll(".reveal").forEach((item) => observer.observe(item));

    const words = document.querySelectorAll(".rotator span");
    let wordIndex = 0;
    window.setInterval(() => {
      words[wordIndex].classList.remove("active");
      wordIndex = (wordIndex + 1) % words.length;
      words[wordIndex].classList.add("active");
    }, 2200);
  }
})();
