// Illustrated game POIs. IDs stay stable when real-world anchors rename places.
import { ICONS } from './icons.js';
const base = `${import.meta.env.BASE_URL}art/poi/`;
export const POI_ART = Object.freeze({
  station: { width: 79.2, theme: '猫咪配送站' },
  bakery: { width: 66.0, theme: '手作面包坊' },
  grocery: { width: 64.8, theme: '蔬果杂货铺' },
  fishsoup: { width: 67.2, theme: '暖灯鱼汤店' },
  morning: { width: 66.0, theme: '晨光面包咖啡屋' },
  florist: { width: 64.8, theme: '花房小店' },
  sakura: { width: 62.4, theme: '樱花公寓' },
  school: { width: 72.0, theme: '银杏校园' },
  office: { width: 64.8, theme: '街角商务楼' },
  books: { width: 67.2, theme: '钟楼书屋' },
  pine: { width: 64.8, theme: '松风住宅' },
  green: { width: 68.4, theme: '绿荫庭院' },
  riverside: { width: 67.2, theme: '河畔文创楼' },
  parkeast: { width: 70.8, theme: '树荫公园门' },
  harbor: { width: 66.0, theme: '港湾住宅' },
  slope: { width: 66.0, theme: '坂道小家' },
  tower: { width: 66.0, theme: '钟塔楼' },
  alley: { width: 66.0, theme: '巷尾小屋' },
});
const kindNames = { station: '配送站', shop: '取货店铺', customer: '送达地点', story: '熟客故事地点' };

export function createPoiLabel(place) {
  const spec = POI_ART[place.id];
  const el = document.createElement('button');
  el.type = 'button';
  // Do not let map controls capture the pointer and swallow a landmark tap.
  el.addEventListener('pointerdown', (event) => event.stopPropagation());
  el.className = `place-label poi-illustration kind-${place.kind}`;
  el.dataset.place = place.id;
  el.style.setProperty('--poi-size', `${spec?.width || 63.6}px`);
  el.title = `${place.name} · ${kindNames[place.kind] || '地点'}`;
  el.setAttribute('aria-label', el.title);
  const art = document.createElement('span');
  art.className = 'poi-art';
  if (spec) {
    const image = document.createElement('img');
    image.src = `${base}${place.id}.webp`;
    image.alt = '';
    image.width = image.height = 512;
    image.draggable = false;
    image.decoding = 'async';
    if (place.kind === 'station') image.fetchPriority = 'high';
    image.addEventListener('error', () => {
      art.hidden = true;
      el.classList.add('poi-art-missing');
    }, { once: true });
    art.appendChild(image);
  } else el.classList.add('poi-art-missing');
  const caption = document.createElement('span');
  caption.className = 'pl-caption';
  const icon = document.createElement('span');
  icon.className = 'pl-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = place.kind === 'station' ? ICONS.home : place.kind === 'shop' ? ICONS[place.goods] : place.kind === 'story' ? ICONS.paw : ICONS.door;
  const name = document.createElement('span');
  name.className = 'pl-name';
  name.textContent = place.name;
  caption.append(icon, name);
  el.append(art, caption);
  return el;
}

// Deliberately exaggerated: these are landmarks for play, not building footprints.
export function setPoiScale(root, factor) {
  const value = Math.max(0.68, Math.min(1.28, factor)).toFixed(2);
  if (root.dataset.poiScale !== value) {
    root.dataset.poiScale = value;
    root.style.setProperty('--poi-zoom', value);
  }
}
