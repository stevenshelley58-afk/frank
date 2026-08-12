export const SHADES = [
  {
    id: 'notint',
    label: 'No tint',
    vlt: 100,
    privacy: 'None',
    legal: null,
    badge: null,
    prompt: 'No film at all. The glass stays completely clear — the seats, headrests and interior trim are plainly visible through the side and rear windows.'
  },
  {
    id: 'vlt70',
    label: '70% VLT',
    vlt: 70,
    privacy: 'Minimal',
    legal: 'front-legal',
    badge: 'Front-legal',
    prompt: 'A very light film. The glass looks almost clear with only the faintest grey cast. Seats, headrests and anyone sitting inside remain easily visible through it.'
  },
  {
    id: 'vlt50',
    label: '50% VLT',
    vlt: 50,
    privacy: 'Slight',
    legal: 'front-legal',
    badge: 'Front-legal',
    prompt: 'A light smoke film. The glass is visibly grey but still see-through — the seats and headrests are clearly readable through it, just softened and slightly darker.'
  },
  {
    id: 'vlt35',
    label: '35% VLT',
    vlt: 35,
    privacy: 'Moderate',
    legal: 'front-legal-min',
    badge: 'Front-legal',
    prompt: 'A medium smoke film. The glass is obviously darkened. You can still make out the shapes of the seats and headrests through it, but not their detail or colour.'
  },
  {
    id: 'vlt20',
    label: '20% VLT',
    vlt: 20,
    privacy: 'High',
    legal: 'rear-only',
    badge: 'Rear only (QLD)',
    prompt: 'A dark film. From outside, the glass reads as deep charcoal. Only vague shadowy shapes are visible inside — you could not identify a person or recognise the seats.'
  },
  {
    id: 'vlt05',
    label: '5% VLT',
    vlt: 5,
    privacy: 'Maximum',
    legal: 'show-only',
    badge: 'Show / off-road only',
    prompt: 'A near-black limousine film. From outside the glass reads as almost solid black, matte and non-reflective, and reveals nothing of the interior at all — no seats, no headrests, no occupants.'
  }
];

export function getShade(id) {
  return SHADES.find(shade => shade.id === id);
}
