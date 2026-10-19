// 低多边形猫咪模型（四足体态，耳尾表达情绪）与头像绘制
import * as THREE from 'three';

const matCache = new Map();
function mat(color) {
  if (!matCache.has(color)) {
    matCache.set(color, new THREE.MeshLambertMaterial({ color, flatShading: true }));
  }
  return matCache.get(color);
}

function sphere(r, color, wSeg = 10, hSeg = 7) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, wSeg, hSeg), mat(color));
  m.castShadow = true;
  return m;
}

function box(w, h, d, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.castShadow = true;
  return m;
}

// 模型朝向 +X
export function createCatModel(def, { kitten = false } = {}) {
  const c = def.colors;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const fluffy = !!def.fluffy;

  const legH = 0.8;
  body.position.y = legH + 0.35;

  const torso = sphere(0.62, c.body, 12, 8);
  torso.scale.set(1.55, 0.88, fluffy ? 1.0 : 0.88);
  body.add(torso);

  const belly = sphere(0.5, c.belly, 10, 6);
  belly.scale.set(1.3, 0.6, 0.8);
  belly.position.set(0.15, -0.22, 0);
  body.add(belly);

  // 花纹
  if (def.id === 'shandian') {
    for (let i = -2; i <= 2; i++) {
      const s = box(0.13, 0.08, 1.1, c.patch);
      s.position.set(i * 0.3, 0.42, 0);
      s.rotation.x = 0;
      const arc = new THREE.Group();
      arc.add(s);
      body.add(arc);
      s.scale.z = 0.95 - Math.abs(i) * 0.08;
    }
  } else if (def.id === 'dundun') {
    for (let i = -1; i <= 1; i++) {
      const s = box(0.14, 0.07, 0.95, c.patch);
      s.position.set(i * 0.38 - 0.1, 0.48, 0);
      body.add(s);
    }
  } else if (def.id === 'laoban') {
    const p1 = sphere(0.36, c.patch, 8, 6);
    p1.scale.set(1.2, 0.6, 1);
    p1.position.set(-0.35, 0.38, 0.12);
    body.add(p1);
    const p2 = sphere(0.32, c.patch2, 8, 6);
    p2.scale.set(1.1, 0.55, 1);
    p2.position.set(0.35, 0.36, -0.2);
    body.add(p2);
  } else if (def.id === 'mianmian') {
    const ruff = sphere(0.45, c.belly, 10, 7);
    ruff.scale.set(0.8, 1, 1.15);
    ruff.position.set(0.72, 0.08, 0);
    body.add(ruff);
  } else if (def.id === 'mom') {
    const p1 = sphere(0.36, c.patch, 8, 6);
    p1.scale.set(1.3, 0.6, 1);
    p1.position.set(-0.2, 0.38, 0);
    body.add(p1);
  }

  // 头
  const head = new THREE.Group();
  head.position.set(0.98, 0.42, 0);
  body.add(head);
  const skull = sphere(0.5, c.body, 12, 8);
  skull.scale.set(0.95, 0.9, 1.05);
  head.add(skull);
  const muzzle = sphere(0.24, c.belly, 8, 6);
  muzzle.scale.set(0.8, 0.7, 1.2);
  muzzle.position.set(0.36, -0.12, 0);
  head.add(muzzle);

  if (def.id === 'mianmian') {
    // 可可棕面罩，中间留白色倒 V
    [-1, 1].forEach((s) => {
      const m = sphere(0.24, c.patch, 8, 6);
      m.scale.set(0.6, 0.8, 0.7);
      m.position.set(0.3, 0.06, s * 0.24);
      head.add(m);
    });
  }
  if (def.id === 'laoban') {
    const m = sphere(0.26, c.patch, 8, 6);
    m.scale.set(0.7, 0.8, 0.8);
    m.position.set(0.12, 0.2, 0.25);
    head.add(m);
    const m2 = sphere(0.24, c.patch2, 8, 6);
    m2.scale.set(0.7, 0.8, 0.8);
    m2.position.set(0.12, 0.2, -0.26);
    head.add(m2);
  }

  const ears = [];
  [-1, 1].forEach((s) => {
    const ear = new THREE.Group();
    ear.position.set(0.0, 0.38, s * 0.26);
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.42, 4), mat(c.ear));
    outer.position.y = 0.16;
    outer.castShadow = true;
    ear.add(outer);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.28, 4), mat(c.inner));
    inner.position.set(0.07, 0.12, 0);
    ear.add(inner);
    ear.rotation.x = s * 0.25;
    head.add(ear);
    ears.push(ear);
  });

  [-1, 1].forEach((s) => {
    const eye = sphere(0.075, c.eye, 6, 5);
    eye.position.set(0.42, 0.06, s * 0.17);
    head.add(eye);
    const pupil = sphere(0.035, '#1E1A17', 5, 4);
    pupil.position.set(0.485, 0.06, s * 0.17);
    head.add(pupil);
  });
  const nose = sphere(0.05, '#D88C83', 5, 4);
  nose.position.set(0.55, -0.04, 0);
  head.add(nose);

  // 腿
  const legs = [];
  const legColor = def.id === 'mianmian' ? c.belly : def.id === 'laoban' ? c.body : c.body;
  [
    [0.6, 0.3],
    [0.6, -0.3],
    [-0.6, 0.3],
    [-0.6, -0.3],
  ].forEach(([x, z], i) => {
    const hip = new THREE.Group();
    hip.position.set(x, legH + 0.15, z);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, legH + 0.1, 6), mat(legColor));
    leg.position.y = -(legH + 0.1) / 2;
    leg.castShadow = true;
    hip.add(leg);
    const paw = sphere(0.13, c.belly, 6, 4);
    paw.scale.set(1.3, 0.6, 1);
    paw.position.set(0.04, -legH - 0.05, 0);
    hip.add(paw);
    root.add(hip);
    legs.push({ hip, phase: i === 0 || i === 3 ? 0 : Math.PI });
  });

  // 尾巴
  const tail = new THREE.Group();
  tail.position.set(-0.9, 0.2, 0);
  body.add(tail);
  const tailSegs = [];
  let parent = tail;
  const segN = 6;
  const tailColor = def.id === 'mianmian' ? c.patch : def.id === 'laoban' ? c.patch : c.body;
  for (let i = 0; i < segN; i++) {
    const seg = new THREE.Group();
    const r = (fluffy ? 0.2 : 0.12) * (1 - i * 0.07);
    const m = sphere(r, i === segN - 1 && def.id === 'dundun' ? c.patch : tailColor, 6, 4);
    m.scale.set(1.6, 1, 1);
    m.position.x = -0.16;
    seg.add(m);
    seg.position.x = i === 0 ? 0 : -0.26;
    seg.rotation.z = -0.32;
    parent.add(seg);
    parent = seg;
    tailSegs.push(seg);
  }

  // 配送包与配件
  const gear = new THREE.Group();
  body.add(gear);
  if (!kitten && c.bag) {
    const big = def.id === 'dundun';
    [-1, 1].forEach((s) => {
      const bag = box(big ? 0.95 : 0.75, big ? 0.62 : 0.5, 0.26, c.bag);
      bag.position.set(-0.05, 0.05, s * (fluffy ? 0.78 : 0.68));
      gear.add(bag);
      const flap = box(big ? 0.97 : 0.77, 0.14, 0.28, shade(c.bag, -0.18));
      flap.position.set(-0.05, 0.3, s * (fluffy ? 0.78 : 0.68));
      gear.add(flap);
      const badge = box(0.22, 0.18, 0.03, '#F5EBDD');
      badge.position.set(-0.05, 0.05, s * ((fluffy ? 0.78 : 0.68) + 0.14));
      gear.add(badge);
    });
    const strap = box(0.2, 0.06, fluffy ? 1.6 : 1.4, '#7A5A40');
    strap.position.set(0.0, 0.55, 0);
    gear.add(strap);
  }
  if (c.scarf) {
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.1, 5, 10), mat(c.scarf));
    scarf.rotation.y = Math.PI / 2;
    scarf.position.set(0.82, 0.25, 0);
    scarf.castShadow = true;
    body.add(scarf);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), mat(c.scarf));
    knot.position.set(1.0, -0.12, 0);
    knot.rotation.z = Math.PI;
    body.add(knot);
  }

  // 雨披（装备后显示）
  const raincoat = new THREE.Group();
  const cape = sphere(0.68, '#7E9367', 10, 6);
  cape.scale.set(1.45, 0.75, 1.05);
  cape.position.set(0, 0.18, 0);
  raincoat.add(cape);
  const hood = sphere(0.36, '#7E9367', 8, 6);
  hood.position.set(0.95, 0.65, 0);
  hood.scale.set(1, 0.7, 1);
  raincoat.add(hood);
  raincoat.visible = false;
  body.add(raincoat);

  // 密封罐（装备后显示）
  const jar = new THREE.Group();
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.36, 8), mat('#C7CED2'));
  can.position.set(-0.5, 0.72, 0);
  can.castShadow = true;
  jar.add(can);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 8), mat('#B86750'));
  lid.position.set(-0.5, 0.93, 0);
  jar.add(lid);
  jar.visible = false;
  body.add(jar);

  const s = (def.scale || 1) * (kitten ? 0.45 : 1) * 0.92;
  root.scale.setScalar(s);

  let walkT = Math.random() * 10;
  const state = { mode: 'idle' };

  function update(dt, mode, speedFactor = 1) {
    state.mode = mode;
    const t = performance.now() / 1000;
    if (mode === 'walk') {
      walkT += dt * 9 * speedFactor;
      legs.forEach(({ hip, phase }) => {
        hip.rotation.z = Math.sin(walkT + phase) * 0.55;
      });
      body.position.y = legH + 0.35 + Math.abs(Math.sin(walkT)) * 0.06;
      body.rotation.z = 0;
      head.rotation.z = Math.sin(walkT * 0.5) * 0.04;
      tailSegs.forEach((sg, i) => {
        sg.rotation.y = Math.sin(walkT * 0.5 + i * 0.5) * 0.12;
        sg.rotation.z = -0.3;
      });
    } else {
      legs.forEach(({ hip }) => (hip.rotation.z *= 0.85));
      body.position.y += (legH + 0.35 - body.position.y) * 0.2;
      const sway = mode === 'wait' ? 0.35 : 0.2;
      tailSegs.forEach((sg, i) => {
        sg.rotation.y = Math.sin(t * 1.6 + i * 0.6) * sway;
        sg.rotation.z = mode === 'sleep' ? -0.05 : -0.38;
      });
      head.rotation.z = mode === 'sleep' ? -0.35 : Math.sin(t * 0.7) * 0.08;
      head.rotation.y = mode === 'wait' ? Math.sin(t * 0.9) * 0.4 : 0;
      ears.forEach((e, i) => (e.rotation.z = mode === 'sleep' ? -0.3 : Math.sin(t * 2 + i) * 0.05));
    }
  }

  function setGear({ raincoat: rc = false, jar: jr = false } = {}) {
    raincoat.visible = rc;
    jar.visible = jr;
  }

  return { root, update, setGear };
}

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return `#${c.getHexString()}`;
}

// ---------- 头像（Canvas 绘制，供 UI 与地图定位点使用） ----------
const avatarCache = new Map();

export function catAvatar(def, { gray = false } = {}) {
  const k = `${def.id}-${gray}`;
  if (avatarCache.has(k)) return avatarCache.get(k);
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const c = def.colors;
  g.save();
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
  g.fillStyle = '#F5EBDD';
  g.fill();
  g.clip();

  const cx = S / 2;
  const cy = S * 0.6;
  const ear = (side, color, scale = 1) => {
    g.beginPath();
    g.moveTo(cx + side * 20 * scale, cy - 26 * scale);
    g.lineTo(cx + side * 40 * scale, cy - 60 * scale);
    g.lineTo(cx + side * 46 * scale, cy - 14 * scale);
    g.closePath();
    g.fillStyle = color;
    g.fill();
  };
  ear(-1, c.ear);
  ear(1, c.ear);
  ear(-1, c.inner, 0.72);
  ear(1, c.inner, 0.72);

  g.beginPath();
  g.ellipse(cx, cy, 44, 38, 0, 0, Math.PI * 2);
  g.fillStyle = c.body;
  g.fill();

  if (def.id === 'mianmian') {
    g.fillStyle = c.patch;
    g.beginPath();
    g.ellipse(cx - 24, cy - 8, 20, 24, 0.3, 0, Math.PI * 2);
    g.ellipse(cx + 24, cy - 8, 20, 24, -0.3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = c.body;
    g.beginPath();
    g.moveTo(cx, cy - 34);
    g.lineTo(cx - 14, cy + 20);
    g.lineTo(cx + 14, cy + 20);
    g.closePath();
    g.fill();
  } else if (def.id === 'laoban') {
    g.fillStyle = c.patch;
    g.beginPath();
    g.ellipse(cx - 22, cy - 16, 20, 18, 0.3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = c.patch2;
    g.beginPath();
    g.ellipse(cx + 24, cy - 14, 18, 18, -0.3, 0, Math.PI * 2);
    g.fill();
  } else if (def.id === 'shandian' || def.id === 'dundun') {
    g.strokeStyle = c.patch;
    g.lineWidth = 4;
    g.lineCap = 'round';
    [-10, 0, 10].forEach((dx) => {
      g.beginPath();
      g.moveTo(cx + dx, cy - 36);
      g.lineTo(cx + dx * 0.7, cy - 22);
      g.stroke();
    });
    if (def.id === 'shandian') {
      [-1, 1].forEach((s) => {
        g.beginPath();
        g.moveTo(cx + s * 44, cy - 2);
        g.lineTo(cx + s * 30, cy);
        g.stroke();
        g.beginPath();
        g.moveTo(cx + s * 44, cy + 8);
        g.lineTo(cx + s * 32, cy + 8);
        g.stroke();
      });
    }
  }

  g.fillStyle = c.belly;
  g.beginPath();
  g.ellipse(cx, cy + 16, 20, 14, 0, 0, Math.PI * 2);
  g.fill();

  [-1, 1].forEach((s) => {
    g.fillStyle = c.eye;
    g.beginPath();
    g.ellipse(cx + s * 17, cy - 4, 7, 8, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1E1A17';
    g.beginPath();
    g.ellipse(cx + s * 17, cy - 4, 2.6, 6.5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(cx + s * 17 + 2, cy - 7, 1.8, 0, Math.PI * 2);
    g.fill();
  });
  g.fillStyle = '#D88C83';
  g.beginPath();
  g.moveTo(cx - 5, cy + 8);
  g.lineTo(cx + 5, cy + 8);
  g.lineTo(cx, cy + 13);
  g.closePath();
  g.fill();
  g.strokeStyle = '#51463D';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(cx, cy + 13);
  g.quadraticCurveTo(cx - 5, cy + 19, cx - 10, cy + 16);
  g.moveTo(cx, cy + 13);
  g.quadraticCurveTo(cx + 5, cy + 19, cx + 10, cy + 16);
  g.stroke();
  g.restore();

  if (gray) {
    const img = g.getImageData(0, 0, S, S);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = img.data[i] * 0.3 + img.data[i + 1] * 0.59 + img.data[i + 2] * 0.11;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 0.6 + 90;
    }
    g.putImageData(img, 0, 0);
  }
  const url = cv.toDataURL();
  avatarCache.set(k, url);
  return url;
}
