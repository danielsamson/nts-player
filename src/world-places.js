// Where NTS shows broadcast from: the place names NTS uses, with map coordinates.
// Built in, so the world view works offline and sends nothing anywhere.
// [lat, lon] or [lat, lon, label] (label when NTS's name isn't how we'd show it)
const WorldPlaces = (() => {
  const P = {
    'london': [51.507, -0.128], 'los angeles': [34.052, -118.244], 'new york': [40.713, -74.006], 'brooklyn': [40.678, -73.944],
    'manchester': [53.481, -2.243], 'berlin': [52.52, 13.405], 'paris': [48.857, 2.352], 'tokyo': [35.68, 139.69],
    'melbourne': [-37.814, 144.963], 'naarm': [-37.814, 144.963, 'Naarm (Melbourne)'], 'kulin nation': [-37.6, 144.7, 'Kulin Nation'],
    'washington dc': [38.907, -77.037, 'Washington DC'], 'detroit': [42.331, -83.046], 'amsterdam': [52.37, 4.895],
    'philadelphia': [39.953, -75.165], 'copenhagen': [55.676, 12.568], 'montreal': [45.502, -73.567], 'shanghai': [31.23, 121.474],
    'chicago': [41.878, -87.63], 'glasgow': [55.864, -4.252], 'toronto': [43.653, -79.383], 'lagos': [6.524, 3.379],
    'seoul': [37.567, 126.978], 'oakland': [37.804, -122.271], 'sydney': [-33.869, 151.209], 'mexico city': [19.433, -99.133],
    'north carolina': [35.78, -78.64], 'lisbon': [38.722, -9.139], 'kingston': [17.997, -76.794], 'bristol': [51.455, -2.588],
    'atlanta': [33.749, -84.388], 'vancouver': [49.283, -123.121], 'austin': [30.267, -97.743], 'osaka': [34.694, 135.502],
    'marseille': [43.296, 5.37], 'san francisco': [37.775, -122.419], 'new jersey': [40.058, -74.406],
    'fort punta christo': [44.9, 13.8, 'Fort Punta Christo'], 'stockholm': [59.329, 18.069], 'birmingham': [52.486, -1.89],
    'kyiv': [50.45, 30.523], 'geneva': [46.204, 6.143], 'leeds': [53.801, -1.549], 'rotterdam': [51.924, 4.478],
    'portland': [45.515, -122.678], 'portland, or': [45.515, -122.678, 'Portland'], 'são paulo': [-23.551, -46.633],
    'sao paulo': [-23.551, -46.633, 'São Paulo'], 'miami': [25.762, -80.192], 'liverpool': [53.408, -2.991], 'beijing': [39.904, 116.407],
    'memphis': [35.149, -90.049], 'turin': [45.07, 7.687], 'lima': [-12.046, -77.043], 'brussels': [50.85, 4.352],
    'virginia': [37.54, -77.436], 'cairo': [30.044, 31.236], 'frankfurt': [50.11, 8.682], 'barcelona': [41.385, 2.173],
    'kampala': [0.348, 32.582], 'milan': [45.464, 9.19], 'galway': [53.271, -9.057], 'cologne': [50.938, 6.96], 'oslo': [59.914, 10.752],
    'outer hebrides': [57.76, -7.02], 'kuwait city': [29.376, 47.977], 'hawaii': [21.307, -157.858], 'oklahoma': [35.468, -97.516],
    'indonesia': [-2.5, 118], 'ghent': [51.054, 3.717], 'belo horizonte': [-19.917, -43.935], 'kent': [51.28, 1.08],
    'tunis': [36.806, 10.181], 'tel aviv': [32.085, 34.782], 'edinburgh': [55.953, -3.189], 'buenos aires': [-34.604, -58.382],
    'beirut': [33.894, 35.502], 'limerick': [52.668, -8.63], 'sheffield': [53.381, -1.47], 'davao city': [7.19, 125.455],
    'cardiff': [51.481, -3.179], 'nashville': [36.163, -86.781], 'cork': [51.898, -8.475], 'minneapolis': [44.978, -93.265],
    'asheville': [35.595, -82.551], 'orlando': [28.538, -81.379], 'mumbai': [19.076, 72.878], 'hamburg': [53.551, 9.994],
    'newcastle': [54.978, -1.618], 'palm springs': [33.83, -116.545], 'caracas': [10.481, -66.904], 'ohio': [39.961, -82.999],
    'new zealand': [-41.29, 174.78], 'amman': [31.954, 35.911], 'la paz': [-16.49, -68.119], 'tallahassee': [30.438, -84.281],
    'new delhi': [28.614, 77.209], 'delhi': [28.614, 77.209], 'mississippi': [32.299, -90.185], 'munich': [48.135, 11.582],
    'malmö': [55.605, 13.003], 'malmo': [55.605, 13.003, 'Malmö'], 'arizona': [33.448, -112.074], 'okinawa': [26.212, 127.681],
    'belfast': [54.597, -5.93], 'basel': [47.56, 7.588], 'bera': [43.28, -1.69], 'tucson': [32.222, -110.975],
    'baltimore': [39.29, -76.612], 'florida': [27.99, -81.76], 'rio de janeiro': [-22.907, -43.173], 'kyoto': [35.012, 135.768],
    'seattle': [47.606, -122.332], 'havana': [23.113, -82.366], 'jakarta': [-6.208, 106.846], 'japan': [36.2, 138.25],
    'oldham': [53.541, -2.112], 'leipzig': [51.34, 12.375], 'papunya': [-23.21, 131.92], 'dakar': [14.716, -17.467],
    'montevideo': [-34.901, -56.164], 'calgary': [51.045, -114.072], 'the hague': [52.07, 4.3], 'leicester': [52.637, -1.14],
    'dublin': [53.35, -6.26], 'florence': [43.77, 11.256], 'tisno': [43.8, 15.64], 'zagreb': [45.815, 15.982], 'denver': [39.739, -104.99],
    'wivenhoe': [51.856, 0.956], 'ramallah': [31.903, 35.204], 'sundsvall': [62.391, 17.307], 'addis ababa': [9.03, 38.74],
    'taipei': [25.033, 121.565], 'east st. louis': [38.625, -90.151, 'East St. Louis'], 'abidjan': [5.36, -4.008],
    'krakow': [50.065, 19.945], 'kraków': [50.065, 19.945], 'st. louis': [38.627, -90.199, 'St. Louis'], 'st. lucia': [13.909, -60.979, 'St. Lucia'],
    'accra': [5.604, -0.187], 'gothenburg': [57.709, 11.975], 'saint-louis': [16.018, -16.489, 'Saint-Louis'], 'vienna': [48.208, 16.374],
    'casablanca': [33.573, -7.59], 'medellín': [6.244, -75.581], 'medellin': [6.244, -75.581, 'Medellín'], 'san juan': [18.466, -66.106],
    'naguanagua': [10.25, -68.01], 'utrecht': [52.091, 5.122], 'zurich': [47.377, 8.542], 'tāmaki makaurau': [-36.848, 174.763, 'Tāmaki Makaurau'],
    'auckland': [-36.848, 174.763], 'nairobi': [-1.292, 36.822], 'yerevan': [40.179, 44.499], 'barranquilla': [10.964, -74.796],
    'düsseldorf': [51.228, 6.774], 'dusseldorf': [51.228, 6.774, 'Düsseldorf'], 'nottingham': [52.954, -1.158],
    // more places NTS broadcasts from now and then
    'fukuoka': [33.59, 130.4], 'madrid': [40.417, -3.704], 'rome': [41.903, 12.496], 'athens': [37.984, 23.728], 'istanbul': [41.008, 28.978],
    'johannesburg': [-26.204, 28.047], 'cape town': [-33.925, 18.424], 'brighton': [50.822, -0.137], 'new orleans': [29.951, -90.072],
    'houston': [29.76, -95.37], 'bogotá': [4.711, -74.072], 'bogota': [4.711, -74.072, 'Bogotá'], 'santiago': [-33.449, -70.669],
    'hong kong': [22.319, 114.169], 'singapore': [1.352, 103.82], 'bangkok': [13.756, 100.502], 'manila': [14.6, 120.98],
    'warsaw': [52.23, 21.012], 'prague': [50.075, 14.438], 'budapest': [47.498, 19.04], 'tbilisi': [41.716, 44.783], 'moscow': [55.756, 37.617],
    'helsinki': [60.17, 24.94], 'reykjavik': [64.146, -21.94], 'mexico': [19.433, -99.133, 'Mexico City'], 'dubai': [25.204, 55.27],
    'bristol, uk': [51.455, -2.588, 'Bristol'], 'kinshasa': [-4.441, 15.266], 'luanda': [-8.839, 13.289], 'bamako': [12.639, -8.003],
    'sapporo': [43.062, 141.354], 'nagoya': [35.181, 136.906], 'brisbane': [-27.47, 153.026], 'perth': [-31.95, 115.86],
    'adelaide': [-34.929, 138.601], 'wellington': [-41.29, 174.78], 'christchurch': [-43.532, 172.636], 'san diego': [32.716, -117.161],
    'boston': [42.36, -71.059], 'dallas': [32.777, -96.797], 'new mexico': [35.687, -105.938], 'naples': [40.852, 14.268], 'napoli': [40.852, 14.268, 'Naples'],
    'bologna': [44.494, 11.343], 'valencia': [39.47, -0.376], 'porto': [41.158, -8.629], 'antwerp': [51.219, 4.402], 'lyon': [45.764, 4.836],
    'bordeaux': [44.838, -0.579], 'tbilisi, georgia': [41.716, 44.783, 'Tbilisi'], 'riga': [56.949, 24.105], 'vilnius': [54.687, 25.28],
    'tallinn': [59.437, 24.754], 'kolbotn': [59.81, 10.8], 'bethlehem': [31.705, 35.2], 'bucharest': [44.427, 26.103], 'sofia': [42.698, 23.322], 'belgrade': [44.787, 20.457], 'ljubljana': [46.056, 14.506],
  };
  // NTS's short codes, for live broadcasts that only carry one
  const SHORT = { LDN: 'london', LA: 'los angeles', NYC: 'new york', MCR: 'manchester', BLN: 'berlin', PAR: 'paris', TKO: 'tokyo', TYO: 'tokyo',
    MEL: 'melbourne', LIS: 'lisbon', PHI: 'philadelphia', DC: 'washington dc', DET: 'detroit', AMS: 'amsterdam', CPH: 'copenhagen',
    MTL: 'montreal', SHA: 'shanghai', CHI: 'chicago', GLA: 'glasgow', TOR: 'toronto', LOS: 'lagos', SEL: 'seoul', SYD: 'sydney',
    MEX: 'mexico city', BRS: 'bristol', ATL: 'atlanta', VAN: 'vancouver', OSA: 'osaka', SF: 'san francisco', STO: 'stockholm' };
  // Not places on a map: grouped as "everywhere and nowhere"
  const NOWHERE = new Set(['', 'earth', 'planet earth', 'hell', 'los santos', 'online', 'internet', 'the internet', 'worldwide', 'space', 'outer space']);

  const key = (x) => String(x || '').trim().toLowerCase();
  const titleCase = (x) => x.replace(/(^|[\s(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

  // { key, label, lat, lon } for a place name (or short code), null when it isn't on the map
  function find(long, short) {
    let k = key(long);
    // some shows put the short code in the long name
    for (const code of [long, short]) if (!P[k] && code && SHORT[String(code).trim().toUpperCase()]) k = SHORT[String(code).trim().toUpperCase()];
    const p = P[k];
    if (!p) return null;
    // places that are the same spot share one dot, keyed by coordinates
    return { key: `${p[0]},${p[1]}`, label: p[2] || titleCase(k), lat: p[0], lon: p[1] };
  }
  const isNowhere = (long) => NOWHERE.has(key(long));
  return { find, isNowhere, all: P };
})();
if (typeof module !== 'undefined') module.exports = WorldPlaces;
