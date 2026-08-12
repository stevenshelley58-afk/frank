// Shade definitions — fallback only; replaced at boot by GET /api/shades.
const SHADES = [
  {
    id: 'notint',
    label: 'No tint',
    vlt: 100,
    privacy: 'None',
    legal: null,
    badge: null,
    prompt: 'show the original vehicle with no window tinting applied'
  },
  {
    id: 'vlt70',
    label: '70% VLT',
    vlt: 70,
    privacy: 'Low',
    legal: 'front-legal',
    badge: 'Front-legal',
    prompt: 'apply a light 70% VLT window tint film to the side and rear windows'
  },
  {
    id: 'vlt50',
    label: '50% VLT',
    vlt: 50,
    privacy: 'Medium',
    legal: 'front-legal',
    badge: 'Front-legal',
    prompt: 'apply a medium 50% VLT window tint film to the side and rear windows'
  },
  {
    id: 'vlt35',
    label: '35% VLT',
    vlt: 35,
    privacy: 'High',
    legal: 'front-legal-min',
    badge: 'Front-legal',
    prompt: 'apply a dark 35% VLT window tint film (Queensland minimum for front windows) to all windows'
  },
  {
    id: 'vlt20',
    label: '20% VLT',
    vlt: 20,
    privacy: 'Very high',
    legal: 'rear-only',
    badge: 'Rear only',
    prompt: 'apply a very dark 20% VLT window tint film to the rear and side windows only, keeping front windows legal'
  },
  {
    id: 'vlt05',
    label: '5% VLT',
    vlt: 5,
    privacy: 'Maximum',
    legal: 'show-only',
    badge: 'Show only',
    prompt: 'apply an extremely dark 5% VLT window tint film to create a dramatic show vehicle appearance'
  }
];

// App state
const state = {
  currentStep: 'photo',
  selectedShadeId: null,
  originalImage: null,
  originalMime: null,
  renderedImage: null,
  renderedMime: null,
  isFallback: false,
  renderId: null,
  leadId: null
};

// Facts to show during rendering
const RENDERING_FACTS = [
  'Tint is not about how dark it looks — it is about how much heat you keep out',
  'Our top ceramic film rejects up to 94% of infrared heat',
  'A cooler cabin means less AC load and less driving fatigue',
  'QLD: front side windows 35% VLT or lighter, behind the driver 20% or lighter',
  'Film brand and glass type change the final look — book a sample viewing to be sure',
  'Every install is backed by a manufacturer warranty'
];

// UI Elements
const app = document.getElementById('app');
const photoInput = document.getElementById('photo-input');
const canvas = document.getElementById('canvas');
const shadesGrid = document.getElementById('shades-grid');
const legalComboBtn = document.getElementById('legal-combo-btn');
const leadForm = document.getElementById('lead-form');
const compareDivider = document.getElementById('compare-divider');
const renderStatus = document.getElementById('render-status');
const renderSuccess = document.getElementById('render-success');
const renderFallback = document.getElementById('render-fallback');
const quoteForm = document.getElementById('quote-form');
const quoteSuccess = document.getElementById('quote-success');
const statusText = document.getElementById('status-text');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  hydrateShades();
  initializePhotoInput();
  initializeShades();
  initializeNavigation();
  initializeCompareSlider();
  initializeLeadForm();
});

// Pull the authoritative shade list (labels, VLT, QLD legality) from the server.
// The inline SHADES array above is only a fallback for a failed/offline fetch.
async function hydrateShades() {
  try {
    const res = await fetch('/api/shades');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.shades) || !data.shades.length) return;
    SHADES.length = 0;
    for (const s of data.shades) SHADES.push(s);
    initializeShades();
  } catch {
    /* keep the inline fallback */
  }
}

// Photo Upload Handler
function initializePhotoInput() {
  photoInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const img = new Image();
      img.onload = () => {
        // Resize to 1280px max dimension, compress to JPEG
        const ctx = canvas.getContext('2d');
        const maxDim = 1280;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        // Export as JPEG, quality 0.85, which also strips EXIF
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        // Strip the "data:image/jpeg;base64," prefix
        state.originalImage = dataUrl.split(',')[1];
        state.originalMime = 'image/jpeg';

        // Show original in compare canvases
        const originalCanvas = document.getElementById('original-canvas');
        const originalCtx = originalCanvas.getContext('2d');
        originalCanvas.width = width;
        originalCanvas.height = height;
        originalCtx.drawImage(img, 0, 0, width, height);

        // Move to shade selection
        goToStep('shade');
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// Shade Selection
function initializeShades() {
  const shadesHtml = SHADES.map(shade => {
    // Colour the badge by legal state — an "off-road only" warning must not
    // read as the same approval as "front-legal".
    const badgeClass = shade.legal === 'rear-only' ? 'shade-badge badge-warn'
      : shade.legal === 'show-only' ? 'shade-badge badge-bad'
      : 'shade-badge badge-ok';
    const badgeHtml = shade.badge ? `<span class="${badgeClass}">${shade.badge}</span>` : '';
    return `
      <button class="shade-chip" data-shade-id="${shade.id}">
        <div class="shade-swatch" style="background-color: hsl(0, 0%, ${shade.vlt * 0.8}%);"></div>
        <div class="shade-info">
          <div class="shade-label">${shade.label}</div>
          <div class="shade-privacy">${shade.privacy} privacy</div>
          ${badgeHtml}
        </div>
      </button>
    `;
  }).join('');

  shadesGrid.innerHTML = shadesHtml;

  // Attach event listeners
  shadesGrid.querySelectorAll('.shade-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      selectShade(btn.dataset.shadeId);
    });
  });
}

function selectShade(shadeId) {
  state.selectedShadeId = shadeId;

  // Visual feedback
  shadesGrid.querySelectorAll('.shade-chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.shadeId === shadeId);
  });

  // Proceed to compare
  goToStep('compare');
  renderTint(shadeId);
}

function initializeNavigation() {
  document.querySelectorAll('.back-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const step = btn.dataset.step;
      goToStep(step);
    });
  });

  document.querySelectorAll('[data-step]').forEach(btn => {
    if (!btn.classList.contains('back-btn')) {
      btn.addEventListener('click', () => {
        goToStep(btn.dataset.step);
      });
    }
  });

  legalComboBtn.addEventListener('click', () => {
    // Darkest QLD-legal combination: 20% behind the driver, 35% up front.
    // The preview renders the 20% rear look; the label states the front rule.
    selectShade('vlt20');
  });
}

function goToStep(stepName) {
  // Hide all steps
  document.querySelectorAll('.step').forEach(step => {
    step.classList.remove('step-active');
  });

  // Show target step
  const targetStep = document.getElementById(`step-${stepName}`);
  if (targetStep) {
    targetStep.classList.add('step-active');
    state.currentStep = stepName;

    // Smooth scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// Render Tint via API
async function renderTint(shadeId) {
  if (!state.originalImage) return;

  const shade = SHADES.find(s => s.id === shadeId);
  if (!shade) return;

  // Show loading state
  renderStatus.style.display = 'block';
  renderSuccess.style.display = 'none';
  renderFallback.style.display = 'none';
  statusText.textContent = 'Rendering your tint...';

  // Rotate facts. Show the first one IMMEDIATELY — waiting on a bare spinner is
  // the most bounce-prone moment in the flow, and a 3s empty gap was exactly
  // where it hurt most.
  let factIndex = 0;
  const showFact = () => {
    const factEl = document.querySelector('.status-fact');
    if (!factEl) return;
    factEl.textContent = RENDERING_FACTS[factIndex % RENDERING_FACTS.length];
    factIndex++;
  };
  showFact();
  const factInterval = setInterval(showFact, 3000);

  try {
    const response = await fetch('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: state.originalImage,
        mime: state.originalMime,
        shadeId: shadeId
      })
    });

    clearInterval(factInterval);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.ok) {
      // Fallback mode
      showFallbackPreview(shade);
      state.isFallback = true;
    } else {
      // Success - show rendered image
      state.renderedImage = data.imageBase64;
      state.renderedMime = data.mime;
      state.renderId = data.renderId;
      showRenderedPreview(data.imageBase64, data.mime);
      state.isFallback = false;
    }
  } catch (error) {
    clearInterval(factInterval);
    console.error('Render error:', error);
    // Fallback on any error
    showFallbackPreview(shade);
    state.isFallback = true;
  }
}

function showRenderedPreview(imageBase64, mime) {
  const tintedCanvas = document.getElementById('tinted-canvas');
  const originalCanvas = document.getElementById('original-canvas');
  const ctx = tintedCanvas.getContext('2d');
  const img = new Image();

  img.onload = () => {
    // The model can return a different size/aspect than we sent. If we drew it
    // at its own dimensions the two compare layers would sit at different
    // scales and the before/after would be comparing different framings —
    // which destroys the whole point of the slider. So always draw into a
    // canvas matching the ORIGINAL, cover-fitting and centre-cropping.
    const cw = originalCanvas.width, ch = originalCanvas.height;
    tintedCanvas.width = cw;
    tintedCanvas.height = ch;
    const scale = Math.max(cw / img.width, ch / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);

    // A previous fallback may have left a brightness filter on this canvas.
    // Without clearing it the real AI render gets darkened a second time.
    tintedCanvas.style.filter = '';

    resetCompareSlider();

    renderStatus.style.display = 'none';
    renderFallback.style.display = 'none';
    renderSuccess.style.display = 'block';
  };

  img.src = `data:${mime};base64,${imageBase64}`;
}

function showFallbackPreview(shade) {
  const tintedCanvas = document.getElementById('tinted-canvas');
  const originalCanvas = document.getElementById('original-canvas');
  const ctx = tintedCanvas.getContext('2d');

  // Copy original canvas
  tintedCanvas.width = originalCanvas.width;
  tintedCanvas.height = originalCanvas.height;
  ctx.drawImage(originalCanvas, 0, 0);

  // Apply CSS brightness filter to the canvas
  const darkness = 1 - (shade.vlt / 100);
  const brightness = Math.max(0.2, 1 - darkness * 0.6);
  tintedCanvas.style.filter = `brightness(${brightness})`;

  resetCompareSlider();

  renderStatus.style.display = 'none';
  renderSuccess.style.display = 'none';
  renderFallback.style.display = 'block';
}

// Compare Slider (Touch + Pointer Support)
function initializeCompareSlider() {
  let isSliding = false;

  const startSlide = () => {
    isSliding = true;
  };

  const endSlide = () => {
    isSliding = false;
  };

  const moveSlide = (e) => {
    if (!isSliding) return;

    const slider = document.getElementById('compare-slider');
    const rect = slider.getBoundingClientRect();
    let x;

    if (e.touches) {
      x = e.touches[0].clientX - rect.left;
    } else {
      x = e.clientX - rect.left;
    }

    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    compareDivider.style.left = percentage + '%';

    // Clip the tinted layer instead of resizing it. Setting width made the
    // canvas re-fit into a narrower box, so the two halves showed the same
    // photo at different scales.
    const tintedImage = slider.querySelector('.tinted-image');
    tintedImage.style.clipPath = `inset(0 0 0 ${percentage}%)`;
  };

  // Pointer events
  compareDivider.addEventListener('pointerdown', startSlide);
  document.addEventListener('pointerup', endSlide);
  document.addEventListener('pointermove', moveSlide);

  // Touch events (backup)
  compareDivider.addEventListener('touchstart', startSlide);
  document.addEventListener('touchend', endSlide);
  document.addEventListener('touchmove', moveSlide, { passive: true });
}

function resetCompareSlider() {
  compareDivider.style.left = '50%';
  const tintedImage = document.getElementById('compare-slider').querySelector('.tinted-image');
  tintedImage.style.clipPath = 'inset(0 0 0 50%)';
}

// Lead Form
function initializeLeadForm() {
  leadForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('name').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const email = document.getElementById('email').value.trim();
    const vehicle = document.getElementById('vehicle').value.trim();

    if (!name || !phone) {
      alert('Please enter your name and phone number');
      return;
    }

    try {
      const response = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone,
          email,
          vehicle,
          shadeId: state.selectedShadeId,
          renderId: state.renderId
        })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      if (data.ok) {
        state.leadId = data.leadId;
        showQuoteSuccess();
      } else {
        throw new Error(data.error || 'Failed to submit');
      }
    } catch (error) {
      console.error('Lead submission error:', error);
      alert('Failed to submit quote request. Please try again or call us at 1800 846 848');
    }
  });
}

function showQuoteSuccess() {
  quoteForm.style.display = 'none';
  quoteSuccess.style.display = 'block';

  // Show rendered image in success state
  const successCanvas = document.getElementById('success-canvas');
  const tintedCanvas = document.getElementById('tinted-canvas');
  const ctx = successCanvas.getContext('2d');

  successCanvas.width = tintedCanvas.width;
  successCanvas.height = tintedCanvas.height;
  ctx.drawImage(tintedCanvas, 0, 0);

  // Smooth scroll to success message
  setTimeout(() => {
    const successSection = quoteSuccess.querySelector('.success-icon');
    successSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
}

// Keyboard navigation (Enter to submit forms)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && state.currentStep === 'quote') {
    if (quoteForm.style.display !== 'none') {
      leadForm.dispatchEvent(new Event('submit'));
    }
  }
});
