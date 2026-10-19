// Camera-facing watercolor characters. Gameplay still controls root position/yaw.
import * as THREE from 'three';
import { catArt } from './catArt.js';

const loader = new THREE.TextureLoader();
const textures = new Map();
function texture(url) {
  if (!textures.has(url)) {
    const t = loader.load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    textures.set(url, t);
  }
  return textures.get(url);
}

// A small equipment badge keeps functional equipment legible without painting
// a raincoat over a static character or changing the underlying gameplay state.
function gearTexture(kind) {
  const key = `gear:${kind}`;
  if (textures.has(key)) return textures.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 96;
  const g = canvas.getContext('2d');
  g.fillStyle = '#F5EBDD';
  g.strokeStyle = kind === 'raincoat' ? '#6A8799' : '#748467';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(48, 48, 40, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.lineWidth = 4;
  g.lineJoin = 'round';
  if (kind === 'raincoat') {
    g.beginPath();
    g.moveTo(48, 23);
    g.bezierCurveTo(34, 43, 29, 49, 29, 58);
    g.bezierCurveTo(29, 82, 67, 82, 67, 58);
    g.bezierCurveTo(67, 49, 62, 43, 48, 23);
    g.closePath();
    g.stroke();
  } else {
    g.strokeRect(30, 34, 36, 40);
    g.strokeRect(27, 25, 42, 9);
    g.beginPath();
    g.moveTo(38, 45);
    g.lineTo(58, 45);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, t);
  return t;
}

export function createCatModel(def, { kitten = false } = {}) {
  const id = kitten
    ? (def.artId || (def.colors.body === '#E39A52' ? 'kitten-orange' : 'kitten-gray'))
    : def.id;
  const art = catArt(id);
  const root = new THREE.Group();
  root.name = `watercolor-cat-${id}`;
  const material = new THREE.SpriteMaterial({
    map: texture(art.sprite), transparent: true, alphaTest: 0.16, depthWrite: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.geometry = sprite.geometry.clone();
  let facing = 1;
  // The anchor is at the paws, not at the middle of the illustration.
  sprite.center.set(0.5, 0.04);
  const height = 2.8;
  sprite.scale.set(height * art.aspect, height, 1);
  root.add(sprite);
  root.scale.setScalar((def.scale || 1) * (kitten ? 0.45 : 1) * 0.92);

  const badges = {};
  if (!kitten && def.colors.bag) {
    for (const [index, kind] of ['raincoat', 'jar'].entries()) {
      const badge = new THREE.Sprite(new THREE.SpriteMaterial({
        map: gearTexture(kind), transparent: true, depthWrite: false, toneMapped: false,
      }));
      badge.position.set(0, 2.8 + index * 0.6, 0);
      badge.scale.setScalar(0.55);
      badge.visible = false;
      root.add(badge);
      badges[kind] = badge;
    }
  }
  let elapsed = 0;
  return {
    root,
    update(dt, mode, speedFactor = 1) {
      elapsed += dt;
      const walking = mode === 'walk';
      const wave = Math.sin(elapsed * (walking ? 9 * speedFactor : 1.8));
      sprite.position.y = walking ? Math.abs(wave) * 0.1 : wave * 0.018;
      material.rotation = walking ? wave * 0.025 : 0;
      material.color.set(mode === 'sleep' ? '#E8E0D4' : '#FFFFFF');
      // Mirror the image for leftward travel while retaining camera-facing art.
      const nextFacing = Math.cos(root.rotation.y) < -0.08 ? -1 : 1;
      if (nextFacing !== facing) {
        const uv = sprite.geometry.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
        uv.needsUpdate = true;
        facing = nextFacing;
      }
    },
    setGear({ raincoat = false, jar = false } = {}) {
      if (badges.raincoat) badges.raincoat.visible = raincoat;
      if (badges.jar) badges.jar.visible = jar;
    },
  };
}

export function catAvatar(def, { gray = false } = {}) {
  const art = catArt(def.id);
  return gray ? art.locked : art.avatar;
}
