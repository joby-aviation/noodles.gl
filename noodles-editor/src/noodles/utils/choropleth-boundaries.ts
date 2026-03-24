import type { Feature, FeatureCollection } from 'geojson'
import { feature as topoFeature } from 'topojson-client'

export type Geography = 'us-states' | 'world-countries' | 'ca-provinces' | 'custom'
export type GeoKey = 'auto' | 'name' | 'abbrev' | 'fips' | 'iso2' | 'iso3'

const BOUNDARY_URLS: Record<Exclude<Geography, 'custom'>, string> = {
  'us-states': 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json',
  'world-countries': 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json',
  'ca-provinces':
    'https://cdn.jsdelivr.net/gh/codeforamerica/click_that_hood@master/public/data/canada.geojson',
}

// [fips_padded, abbrev, name]
const US_STATES: [string, string, string][] = [
  ['01', 'AL', 'Alabama'],
  ['02', 'AK', 'Alaska'],
  ['04', 'AZ', 'Arizona'],
  ['05', 'AR', 'Arkansas'],
  ['06', 'CA', 'California'],
  ['08', 'CO', 'Colorado'],
  ['09', 'CT', 'Connecticut'],
  ['10', 'DE', 'Delaware'],
  ['11', 'DC', 'District of Columbia'],
  ['12', 'FL', 'Florida'],
  ['13', 'GA', 'Georgia'],
  ['15', 'HI', 'Hawaii'],
  ['16', 'ID', 'Idaho'],
  ['17', 'IL', 'Illinois'],
  ['18', 'IN', 'Indiana'],
  ['19', 'IA', 'Iowa'],
  ['20', 'KS', 'Kansas'],
  ['21', 'KY', 'Kentucky'],
  ['22', 'LA', 'Louisiana'],
  ['23', 'ME', 'Maine'],
  ['24', 'MD', 'Maryland'],
  ['25', 'MA', 'Massachusetts'],
  ['26', 'MI', 'Michigan'],
  ['27', 'MN', 'Minnesota'],
  ['28', 'MS', 'Mississippi'],
  ['29', 'MO', 'Missouri'],
  ['30', 'MT', 'Montana'],
  ['31', 'NE', 'Nebraska'],
  ['32', 'NV', 'Nevada'],
  ['33', 'NH', 'New Hampshire'],
  ['34', 'NJ', 'New Jersey'],
  ['35', 'NM', 'New Mexico'],
  ['36', 'NY', 'New York'],
  ['37', 'NC', 'North Carolina'],
  ['38', 'ND', 'North Dakota'],
  ['39', 'OH', 'Ohio'],
  ['40', 'OK', 'Oklahoma'],
  ['41', 'OR', 'Oregon'],
  ['42', 'PA', 'Pennsylvania'],
  ['44', 'RI', 'Rhode Island'],
  ['45', 'SC', 'South Carolina'],
  ['46', 'SD', 'South Dakota'],
  ['47', 'TN', 'Tennessee'],
  ['48', 'TX', 'Texas'],
  ['49', 'UT', 'Utah'],
  ['50', 'VT', 'Vermont'],
  ['51', 'VA', 'Virginia'],
  ['53', 'WA', 'Washington'],
  ['54', 'WV', 'West Virginia'],
  ['55', 'WI', 'Wisconsin'],
  ['56', 'WY', 'Wyoming'],
]

// Keyed by zero-padded FIPS string (matches feature.id after padding)
const US_STATE_BY_FIPS = new Map(
  US_STATES.map(([fips, abbrev, name]) => [fips, { fips, abbrev, name }])
)
const US_STATE_BY_ABBREV = new Map(
  US_STATES.map(([fips, abbrev, name]) => [abbrev.toLowerCase(), { fips, abbrev, name }])
)
const US_STATE_BY_NAME = new Map(
  US_STATES.map(([fips, abbrev, name]) => [name.toLowerCase(), { fips, abbrev, name }])
)

// [numeric, iso2, iso3, name]
const COUNTRY_TABLE: [string, string, string, string][] = [
  ['4', 'AF', 'AFG', 'Afghanistan'],
  ['8', 'AL', 'ALB', 'Albania'],
  ['12', 'DZ', 'DZA', 'Algeria'],
  ['20', 'AD', 'AND', 'Andorra'],
  ['24', 'AO', 'AGO', 'Angola'],
  ['28', 'AG', 'ATG', 'Antigua and Barbuda'],
  ['32', 'AR', 'ARG', 'Argentina'],
  ['36', 'AU', 'AUS', 'Australia'],
  ['40', 'AT', 'AUT', 'Austria'],
  ['31', 'AZ', 'AZE', 'Azerbaijan'],
  ['44', 'BS', 'BHS', 'Bahamas'],
  ['48', 'BH', 'BHR', 'Bahrain'],
  ['50', 'BD', 'BGD', 'Bangladesh'],
  ['52', 'BB', 'BRB', 'Barbados'],
  ['112', 'BY', 'BLR', 'Belarus'],
  ['56', 'BE', 'BEL', 'Belgium'],
  ['84', 'BZ', 'BLZ', 'Belize'],
  ['204', 'BJ', 'BEN', 'Benin'],
  ['64', 'BT', 'BTN', 'Bhutan'],
  ['68', 'BO', 'BOL', 'Bolivia'],
  ['70', 'BA', 'BIH', 'Bosnia and Herzegovina'],
  ['72', 'BW', 'BWA', 'Botswana'],
  ['76', 'BR', 'BRA', 'Brazil'],
  ['96', 'BN', 'BRN', 'Brunei'],
  ['100', 'BG', 'BGR', 'Bulgaria'],
  ['854', 'BF', 'BFA', 'Burkina Faso'],
  ['108', 'BI', 'BDI', 'Burundi'],
  ['116', 'KH', 'KHM', 'Cambodia'],
  ['120', 'CM', 'CMR', 'Cameroon'],
  ['124', 'CA', 'CAN', 'Canada'],
  ['132', 'CV', 'CPV', 'Cape Verde'],
  ['140', 'CF', 'CAF', 'Central African Republic'],
  ['148', 'TD', 'TCD', 'Chad'],
  ['152', 'CL', 'CHL', 'Chile'],
  ['156', 'CN', 'CHN', 'China'],
  ['170', 'CO', 'COL', 'Colombia'],
  ['174', 'KM', 'COM', 'Comoros'],
  ['180', 'CD', 'COD', 'Democratic Republic of the Congo'],
  ['178', 'CG', 'COG', 'Republic of the Congo'],
  ['188', 'CR', 'CRI', 'Costa Rica'],
  ['384', 'CI', 'CIV', "Cote d'Ivoire"],
  ['191', 'HR', 'HRV', 'Croatia'],
  ['192', 'CU', 'CUB', 'Cuba'],
  ['196', 'CY', 'CYP', 'Cyprus'],
  ['203', 'CZ', 'CZE', 'Czech Republic'],
  ['208', 'DK', 'DNK', 'Denmark'],
  ['262', 'DJ', 'DJI', 'Djibouti'],
  ['212', 'DM', 'DMA', 'Dominica'],
  ['214', 'DO', 'DOM', 'Dominican Republic'],
  ['218', 'EC', 'ECU', 'Ecuador'],
  ['818', 'EG', 'EGY', 'Egypt'],
  ['222', 'SV', 'SLV', 'El Salvador'],
  ['226', 'GQ', 'GNQ', 'Equatorial Guinea'],
  ['232', 'ER', 'ERI', 'Eritrea'],
  ['233', 'EE', 'EST', 'Estonia'],
  ['231', 'ET', 'ETH', 'Ethiopia'],
  ['242', 'FJ', 'FJI', 'Fiji'],
  ['246', 'FI', 'FIN', 'Finland'],
  ['250', 'FR', 'FRA', 'France'],
  ['266', 'GA', 'GAB', 'Gabon'],
  ['270', 'GM', 'GMB', 'Gambia'],
  ['268', 'GE', 'GEO', 'Georgia'],
  ['276', 'DE', 'DEU', 'Germany'],
  ['288', 'GH', 'GHA', 'Ghana'],
  ['300', 'GR', 'GRC', 'Greece'],
  ['308', 'GD', 'GRD', 'Grenada'],
  ['320', 'GT', 'GTM', 'Guatemala'],
  ['324', 'GN', 'GIN', 'Guinea'],
  ['624', 'GW', 'GNB', 'Guinea-Bissau'],
  ['328', 'GY', 'GUY', 'Guyana'],
  ['332', 'HT', 'HTI', 'Haiti'],
  ['340', 'HN', 'HND', 'Honduras'],
  ['348', 'HU', 'HUN', 'Hungary'],
  ['352', 'IS', 'ISL', 'Iceland'],
  ['356', 'IN', 'IND', 'India'],
  ['360', 'ID', 'IDN', 'Indonesia'],
  ['364', 'IR', 'IRN', 'Iran'],
  ['368', 'IQ', 'IRQ', 'Iraq'],
  ['372', 'IE', 'IRL', 'Ireland'],
  ['376', 'IL', 'ISR', 'Israel'],
  ['380', 'IT', 'ITA', 'Italy'],
  ['388', 'JM', 'JAM', 'Jamaica'],
  ['392', 'JP', 'JPN', 'Japan'],
  ['400', 'JO', 'JOR', 'Jordan'],
  ['398', 'KZ', 'KAZ', 'Kazakhstan'],
  ['404', 'KE', 'KEN', 'Kenya'],
  ['296', 'KI', 'KIR', 'Kiribati'],
  ['408', 'KP', 'PRK', 'North Korea'],
  ['410', 'KR', 'KOR', 'South Korea'],
  ['414', 'KW', 'KWT', 'Kuwait'],
  ['417', 'KG', 'KGZ', 'Kyrgyzstan'],
  ['418', 'LA', 'LAO', 'Laos'],
  ['428', 'LV', 'LVA', 'Latvia'],
  ['422', 'LB', 'LBN', 'Lebanon'],
  ['426', 'LS', 'LSO', 'Lesotho'],
  ['430', 'LR', 'LBR', 'Liberia'],
  ['434', 'LY', 'LBY', 'Libya'],
  ['438', 'LI', 'LIE', 'Liechtenstein'],
  ['440', 'LT', 'LTU', 'Lithuania'],
  ['442', 'LU', 'LUX', 'Luxembourg'],
  ['807', 'MK', 'MKD', 'North Macedonia'],
  ['450', 'MG', 'MDG', 'Madagascar'],
  ['454', 'MW', 'MWI', 'Malawi'],
  ['458', 'MY', 'MYS', 'Malaysia'],
  ['462', 'MV', 'MDV', 'Maldives'],
  ['466', 'ML', 'MLI', 'Mali'],
  ['470', 'MT', 'MLT', 'Malta'],
  ['584', 'MH', 'MHL', 'Marshall Islands'],
  ['478', 'MR', 'MRT', 'Mauritania'],
  ['480', 'MU', 'MUS', 'Mauritius'],
  ['484', 'MX', 'MEX', 'Mexico'],
  ['583', 'FM', 'FSM', 'Micronesia'],
  ['498', 'MD', 'MDA', 'Moldova'],
  ['492', 'MC', 'MCO', 'Monaco'],
  ['496', 'MN', 'MNG', 'Mongolia'],
  ['499', 'ME', 'MNE', 'Montenegro'],
  ['504', 'MA', 'MAR', 'Morocco'],
  ['508', 'MZ', 'MOZ', 'Mozambique'],
  ['516', 'NA', 'NAM', 'Namibia'],
  ['520', 'NR', 'NRU', 'Nauru'],
  ['524', 'NP', 'NPL', 'Nepal'],
  ['528', 'NL', 'NLD', 'Netherlands'],
  ['554', 'NZ', 'NZL', 'New Zealand'],
  ['558', 'NI', 'NIC', 'Nicaragua'],
  ['562', 'NE', 'NER', 'Niger'],
  ['566', 'NG', 'NGA', 'Nigeria'],
  ['578', 'NO', 'NOR', 'Norway'],
  ['512', 'OM', 'OMN', 'Oman'],
  ['586', 'PK', 'PAK', 'Pakistan'],
  ['585', 'PW', 'PLW', 'Palau'],
  ['591', 'PA', 'PAN', 'Panama'],
  ['598', 'PG', 'PNG', 'Papua New Guinea'],
  ['600', 'PY', 'PRY', 'Paraguay'],
  ['604', 'PE', 'PER', 'Peru'],
  ['608', 'PH', 'PHL', 'Philippines'],
  ['616', 'PL', 'POL', 'Poland'],
  ['620', 'PT', 'PRT', 'Portugal'],
  ['634', 'QA', 'QAT', 'Qatar'],
  ['642', 'RO', 'ROU', 'Romania'],
  ['643', 'RU', 'RUS', 'Russia'],
  ['646', 'RW', 'RWA', 'Rwanda'],
  ['659', 'KN', 'KNA', 'Saint Kitts and Nevis'],
  ['662', 'LC', 'LCA', 'Saint Lucia'],
  ['670', 'VC', 'VCT', 'Saint Vincent and the Grenadines'],
  ['882', 'WS', 'WSM', 'Samoa'],
  ['674', 'SM', 'SMR', 'San Marino'],
  ['678', 'ST', 'STP', 'Sao Tome and Principe'],
  ['682', 'SA', 'SAU', 'Saudi Arabia'],
  ['686', 'SN', 'SEN', 'Senegal'],
  ['688', 'RS', 'SRB', 'Serbia'],
  ['690', 'SC', 'SYC', 'Seychelles'],
  ['694', 'SL', 'SLE', 'Sierra Leone'],
  ['702', 'SG', 'SGP', 'Singapore'],
  ['703', 'SK', 'SVK', 'Slovakia'],
  ['705', 'SI', 'SVN', 'Slovenia'],
  ['90', 'SB', 'SLB', 'Solomon Islands'],
  ['706', 'SO', 'SOM', 'Somalia'],
  ['710', 'ZA', 'ZAF', 'South Africa'],
  ['728', 'SS', 'SSD', 'South Sudan'],
  ['724', 'ES', 'ESP', 'Spain'],
  ['144', 'LK', 'LKA', 'Sri Lanka'],
  ['729', 'SD', 'SDN', 'Sudan'],
  ['740', 'SR', 'SUR', 'Suriname'],
  ['748', 'SZ', 'SWZ', 'Eswatini'],
  ['752', 'SE', 'SWE', 'Sweden'],
  ['756', 'CH', 'CHE', 'Switzerland'],
  ['760', 'SY', 'SYR', 'Syria'],
  ['158', 'TW', 'TWN', 'Taiwan'],
  ['762', 'TJ', 'TJK', 'Tajikistan'],
  ['834', 'TZ', 'TZA', 'Tanzania'],
  ['764', 'TH', 'THA', 'Thailand'],
  ['626', 'TL', 'TLS', 'Timor-Leste'],
  ['768', 'TG', 'TGO', 'Togo'],
  ['776', 'TO', 'TON', 'Tonga'],
  ['780', 'TT', 'TTO', 'Trinidad and Tobago'],
  ['788', 'TN', 'TUN', 'Tunisia'],
  ['792', 'TR', 'TUR', 'Turkey'],
  ['795', 'TM', 'TKM', 'Turkmenistan'],
  ['798', 'TV', 'TUV', 'Tuvalu'],
  ['800', 'UG', 'UGA', 'Uganda'],
  ['804', 'UA', 'UKR', 'Ukraine'],
  ['784', 'AE', 'ARE', 'United Arab Emirates'],
  ['826', 'GB', 'GBR', 'United Kingdom'],
  ['840', 'US', 'USA', 'United States'],
  ['858', 'UY', 'URY', 'Uruguay'],
  ['860', 'UZ', 'UZB', 'Uzbekistan'],
  ['548', 'VU', 'VUT', 'Vanuatu'],
  ['336', 'VA', 'VAT', 'Vatican City'],
  ['862', 'VE', 'VEN', 'Venezuela'],
  ['704', 'VN', 'VNM', 'Vietnam'],
  ['887', 'YE', 'YEM', 'Yemen'],
  ['894', 'ZM', 'ZMB', 'Zambia'],
  ['716', 'ZW', 'ZWE', 'Zimbabwe'],
  ['926', 'XK', 'XKX', 'Kosovo'],
  ['732', 'EH', 'ESH', 'Western Sahara'],
  ['275', 'PS', 'PSE', 'Palestine'],
  ['531', 'CW', 'CUW', 'Curacao'],
  ['533', 'AW', 'ABW', 'Aruba'],
]

// Common name aliases users might type
const COUNTRY_NAME_ALIASES: Record<string, string> = {
  usa: 'united states',
  'united states of america': 'united states',
  uk: 'united kingdom',
  'great britain': 'united kingdom',
  england: 'united kingdom',
  russia: 'russia',
  'russian federation': 'russia',
  czechia: 'czech republic',
  'ivory coast': "cote d'ivoire",
  'north korea': 'north korea',
  'south korea': 'south korea',
  'republic of korea': 'south korea',
  "democratic people's republic of korea": 'north korea',
  'dr congo': 'democratic republic of the congo',
  'congo-kinshasa': 'democratic republic of the congo',
  'congo-brazzaville': 'republic of the congo',
  eswatini: 'eswatini',
  swaziland: 'eswatini',
  'east timor': 'timor-leste',
  burma: 'myanmar',
  'cape verde': 'cape verde',
}

const COUNTRY_BY_NUMERIC = new Map(
  COUNTRY_TABLE.map(([n, iso2, iso3, name]) => [n, { iso2, iso3, name }])
)
const COUNTRY_BY_ISO2 = new Map(
  COUNTRY_TABLE.map(([, iso2, iso3, name]) => [iso2.toLowerCase(), { iso2, iso3, name }])
)
const COUNTRY_BY_ISO3 = new Map(
  COUNTRY_TABLE.map(([, iso2, iso3, name]) => [iso3.toLowerCase(), { iso2, iso3, name }])
)
const COUNTRY_BY_NAME = new Map(
  COUNTRY_TABLE.map(([, iso2, iso3, name]) => [name.toLowerCase(), { iso2, iso3, name }])
)

// [code, name]
const CA_PROVINCES: [string, string][] = [
  ['AB', 'Alberta'],
  ['BC', 'British Columbia'],
  ['MB', 'Manitoba'],
  ['NB', 'New Brunswick'],
  ['NL', 'Newfoundland and Labrador'],
  ['NS', 'Nova Scotia'],
  ['NT', 'Northwest Territories'],
  ['NU', 'Nunavut'],
  ['ON', 'Ontario'],
  ['PE', 'Prince Edward Island'],
  ['QC', 'Quebec'],
  ['SK', 'Saskatchewan'],
  ['YT', 'Yukon'],
]

const CA_PROVINCE_BY_CODE = new Map(
  CA_PROVINCES.map(([code, name]) => [code.toLowerCase(), { code, name }])
)
const CA_PROVINCE_BY_NAME = new Map(
  CA_PROVINCES.map(([code, name]) => [name.toLowerCase(), { code, name }])
)
// Common alternates
CA_PROVINCE_BY_NAME.set('newfoundland', CA_PROVINCE_BY_CODE.get('nl')!)
CA_PROVINCE_BY_NAME.set('labrador', CA_PROVINCE_BY_CODE.get('nl')!)
CA_PROVINCE_BY_NAME.set('pei', CA_PROVINCE_BY_CODE.get('pe')!)
CA_PROVINCE_BY_NAME.set('prince edward island', CA_PROVINCE_BY_CODE.get('pe')!)
CA_PROVINCE_BY_NAME.set('nwt', CA_PROVINCE_BY_CODE.get('nt')!)

// Module-level fetch cache to avoid re-fetching across operator executions
const boundaryCache = new Map<string, FeatureCollection>()

function enrichUsStates(features: Feature[]): Feature[] {
  return features.map(f => {
    const numericId = String(f.id ?? '')
    const fips = numericId.padStart(2, '0')
    const info = US_STATE_BY_FIPS.get(fips)
    if (!info) return f
    return {
      ...f,
      properties: {
        ...f.properties,
        name: info.name,
        fips: info.fips,
        abbrev: info.abbrev,
      },
    }
  })
}

function enrichWorldCountries(features: Feature[]): Feature[] {
  return features.map(f => {
    const numericId = String(f.id ?? '')
    const info = COUNTRY_BY_NUMERIC.get(numericId)
    if (!info) return f
    return {
      ...f,
      properties: {
        ...f.properties,
        name: info.name,
        iso2: info.iso2,
        iso3: info.iso3,
      },
    }
  })
}

function enrichCaProvinces(features: Feature[]): Feature[] {
  return features.map(f => {
    const rawName = (f.properties?.name as string | undefined)?.toLowerCase() ?? ''
    const info = CA_PROVINCE_BY_NAME.get(rawName)
    if (!info) return f
    return {
      ...f,
      properties: {
        ...f.properties,
        name: info.name,
        code: info.code,
        abbrev: info.code,
      },
    }
  })
}

export async function getBoundaries(
  geography: Geography,
  userBoundaries?: FeatureCollection
): Promise<FeatureCollection> {
  if (geography === 'custom') {
    return userBoundaries ?? { type: 'FeatureCollection', features: [] }
  }

  if (boundaryCache.has(geography)) {
    return boundaryCache.get(geography)!
  }

  const url = BOUNDARY_URLS[geography]
  const response = await fetch(url)
  const data = await response.json()

  let features: Feature[]

  if (data.type === 'Topology') {
    const objectName = Object.keys(data.objects)[0]
    const fc = topoFeature(data, data.objects[objectName]) as FeatureCollection
    features = fc.features
  } else {
    features = (data as FeatureCollection).features
  }

  if (geography === 'us-states') features = enrichUsStates(features)
  else if (geography === 'world-countries') features = enrichWorldCountries(features)
  else if (geography === 'ca-provinces') features = enrichCaProvinces(features)

  const fc: FeatureCollection = { type: 'FeatureCollection', features }
  boundaryCache.set(geography, fc)
  return fc
}

// Clear the cache (useful for testing)
export function clearBoundaryCache() {
  boundaryCache.clear()
}

type StateInfo = { fips: string; abbrev: string; name: string }
type CountryInfo = { iso2: string; iso3: string; name: string }
type ProvinceInfo = { code: string; name: string }

function lookupValue(
  rawVal: string,
  geoKey: Exclude<GeoKey, 'auto'>,
  geography: Exclude<Geography, 'custom'>
): StateInfo | CountryInfo | ProvinceInfo | null {
  const v = rawVal.trim()
  if (!v) return null

  if (geography === 'us-states') {
    if (geoKey === 'fips') {
      const numeric = parseInt(v, 10)
      if (Number.isNaN(numeric)) return null
      return US_STATE_BY_FIPS.get(String(numeric).padStart(2, '0')) ?? null
    }
    if (geoKey === 'abbrev') return US_STATE_BY_ABBREV.get(v.toLowerCase()) ?? null
    if (geoKey === 'name') return US_STATE_BY_NAME.get(v.toLowerCase()) ?? null
  }

  if (geography === 'world-countries') {
    if (geoKey === 'iso2') return COUNTRY_BY_ISO2.get(v.toLowerCase()) ?? null
    if (geoKey === 'iso3') return COUNTRY_BY_ISO3.get(v.toLowerCase()) ?? null
    if (geoKey === 'name') {
      const normalized = COUNTRY_NAME_ALIASES[v.toLowerCase()] ?? v.toLowerCase()
      return COUNTRY_BY_NAME.get(normalized) ?? null
    }
  }

  if (geography === 'ca-provinces') {
    if (geoKey === 'abbrev') return CA_PROVINCE_BY_CODE.get(v.toLowerCase()) ?? null
    if (geoKey === 'name') return CA_PROVINCE_BY_NAME.get(v.toLowerCase()) ?? null
  }

  return null
}

function getGeoKeyOptions(geography: Exclude<Geography, 'custom'>): Exclude<GeoKey, 'auto'>[] {
  if (geography === 'us-states') return ['abbrev', 'name', 'fips']
  if (geography === 'world-countries') return ['iso2', 'iso3', 'name']
  if (geography === 'ca-provinces') return ['abbrev', 'name']
  return ['name']
}

export function detectGeoKey(
  data: Record<string, unknown>[],
  joinKey: string,
  geography: Exclude<Geography, 'custom'>
): Exclude<GeoKey, 'auto'> {
  const samples = data
    .slice(0, 20)
    .map(row => String(row[joinKey] ?? '').trim())
    .filter(v => v.length > 0)

  const candidates = getGeoKeyOptions(geography)

  if (samples.length === 0) return candidates[0]
  let bestKey: Exclude<GeoKey, 'auto'> = candidates[0]
  let bestScore = 0

  for (const geoKey of candidates) {
    const matches = samples.filter(v => lookupValue(v, geoKey, geography) !== null).length
    const score = matches / samples.length
    if (score > bestScore) {
      bestScore = score
      bestKey = geoKey
    }
  }

  if (bestScore < 0.5) {
    console.warn(
      `ChoroplethJoin: only ${Math.round(bestScore * 100)}% of "${joinKey}" values matched ${geography}. Check joinKey and geoKey settings.`
    )
  }

  return bestKey
}

// Normalize a user data value to the canonical form used as the map key
function normalizeUserValue(rawVal: string, geoKey: Exclude<GeoKey, 'auto'>): string {
  const v = rawVal.trim()
  if (geoKey === 'fips') {
    const numeric = parseInt(v, 10)
    return Number.isNaN(numeric) ? '' : String(numeric).padStart(2, '0')
  }
  if (geoKey === 'name') {
    return COUNTRY_NAME_ALIASES[v.toLowerCase()] ?? v.toLowerCase()
  }
  return v.toLowerCase()
}

// Get the normalized key from a feature's properties that matches the geoKey type
function getFeatureNormalizedKey(feature: Feature, geoKey: Exclude<GeoKey, 'auto'>): string | null {
  const props = feature.properties ?? {}
  let val: unknown

  if (geoKey === 'fips') val = props.fips
  else if (geoKey === 'abbrev') val = props.abbrev ?? props.code
  else if (geoKey === 'iso2') val = props.iso2
  else if (geoKey === 'iso3') val = props.iso3
  else if (geoKey === 'name') val = props.name

  if (val == null) return null
  const str = String(val)
  return normalizeUserValue(str, geoKey)
}

export function joinDataToFeatures(
  boundaries: FeatureCollection,
  data: Record<string, unknown>[],
  joinKey: string,
  geoKey: Exclude<GeoKey, 'auto'>
): FeatureCollection {
  // Build lookup from normalized key → data row
  const dataByKey = new Map<string, Record<string, unknown>>()
  for (const row of data) {
    const rawVal = row[joinKey]
    if (rawVal == null) continue
    const key = normalizeUserValue(String(rawVal), geoKey)
    if (key) dataByKey.set(key, row)
  }

  const features = boundaries.features.map(feature => {
    const featureKey = getFeatureNormalizedKey(feature, geoKey)
    if (featureKey === null) return feature
    const match = dataByKey.get(featureKey)
    if (!match) return feature
    return {
      ...feature,
      properties: { ...feature.properties, ...match },
    }
  })

  return { type: 'FeatureCollection', features }
}
