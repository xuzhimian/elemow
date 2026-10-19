// Runtime-ready watercolor art, shared by DOM portraits and both map renderers.
const base = `${import.meta.env.BASE_URL}art/`;
const ids = new Set(['dundun', 'shandian', 'laoban', 'mianmian', 'mom', 'kitten-gray', 'kitten-orange']);

export function catArt(id) {
  const key = ids.has(id) ? id : 'mom';
  return {
    sprite: `${base}cats/${key}.webp`,
    avatar: `${base}cats/${key}-avatar.webp`,
    locked: `${base}cats/${key}-locked.webp`,
    aspect: key === 'mianmian' ? 1374 / 1145 : 1.5,
  };
}

export const stationArt = `${base}station/interior.webp`;
