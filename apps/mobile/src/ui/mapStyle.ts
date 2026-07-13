/**
 * Modern graphite-dark Google Maps style: near-black canvas, softly lifted
 * roads, no POI clutter — labels kept quiet so pins and the route line carry
 * the screen.
 *
 * Shared by every map in the app (LiveMap, RequestRouteMap) so they cannot
 * drift into looking like different products.
 */
export const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0e1216' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6f7a85' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0e1216' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ visibility: 'on' }, { color: '#101d16' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1e252c' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#87919b' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#242d35' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2d3843' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0a0e12' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3e5561' }] },
];
