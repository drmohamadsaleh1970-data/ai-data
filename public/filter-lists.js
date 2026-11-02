// Option lists for the ai-home.world sync filter. The page merges these with every value
// actually seen in the imported data and the feed, so real spellings are always offered.

// Countries, as nationality is recorded in Dubai Land Department data (country name).
export const NATIONALITIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan',
  'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana',
  'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cambodia', 'Cameroon', 'Canada', 'Cape Verde', 'Central African Republic', 'Chad',
  'Chile', 'China', 'Colombia', 'Comoros', 'Congo', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic', 'Democratic Republic of the Congo',
  'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini',
  'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea',
  'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hong Kong', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel',
  'Italy', 'Ivory Coast', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia',
  'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Macau', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives',
  'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco',
  'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea',
  'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland',
  'Portugal', 'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa',
  'San Marino', 'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia',
  'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland',
  'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey',
  'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan', 'Vanuatu',
  'Vatican City', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe',
];

// Dubai communities by the names people use. Matching also checks the project name, and
// nicknames such as JVC, JVT, JLT, Marina, Downtown and Dubai Hills are mapped on the
// server to their official Land Department area names.
export const DUBAI_AREAS = [
  'Al Barari', 'Al Barsha', 'Al Furjan', 'Al Habtoor City', 'Al Jaddaf', 'Al Khail Heights', 'Al Quoz', 'Al Safa', 'Al Sufouh', 'Al Warqa',
  'Arabian Ranches', 'Arjan', 'Barsha Heights', 'Bluewaters', 'Business Bay', 'City Walk', 'Damac Hills', 'Damac Hills 2', 'Deira',
  'Discovery Gardens', 'Downtown Dubai', 'Dubai Creek Harbour', 'Dubai Harbour', 'Dubai Hills Estate', 'Dubai Investments Park', 'Dubai Islands',
  'Dubai Land', 'Dubai Marina', 'Dubai Maritime City', 'Dubai Production City', 'Dubai Silicon Oasis', 'Dubai South', 'Dubai Sports City',
  'Dubai Studio City', 'Emaar Beachfront', 'Emirates Hills', 'Green Community', 'International City', 'Jebel Ali', 'Jumeirah',
  'Jumeirah Bay', 'Jumeirah Beach Residence', 'Jumeirah Golf Estates', 'Jumeirah Islands', 'Jumeirah Lake Towers (JLT)', 'Jumeirah Park',
  'Jumeirah Village Circle (JVC)', 'Jumeirah Village Triangle (JVT)', 'La Mer', 'Liwan', 'Majan', 'Meadows', 'Meydan', 'Mirdif',
  'Mohammed Bin Rashid City', 'Motor City', 'Mudon', 'Nad Al Sheba', 'Palm Jebel Ali', 'Palm Jumeirah', 'Port de La Mer', 'Remraam',
  'Sobha Hartland', 'Springs', 'The Greens', 'The Lakes', 'The Valley', 'The Villa', 'The Views', 'Tilal Al Ghaf', 'Town Square',
  'Umm Suqeim', 'Victory Heights', 'Wasl Gate', 'Zabeel',
];

export const PROPERTY_TYPES = ['Unit', 'Villa', 'Land', 'Building', 'Apartment', 'Townhouse', 'Penthouse', 'Office', 'Shop', 'Hotel Apartment'];

export const PRICE_STEPS_AED = [500000, 750000, 1000000, 1500000, 2000000, 3000000, 4000000, 5000000, 7500000, 10000000, 15000000, 20000000, 30000000, 50000000];
