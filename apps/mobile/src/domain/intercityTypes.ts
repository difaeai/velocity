export type IntercityVehicleType = 'standard_ac' | 'business_ac' | 'non_ac' | 'coaster' | 'suv' | 'hiace';
export type IntercityTripStatus = 'scheduled' | 'boarding' | 'in_progress' | 'completed' | 'cancelled';
export type IntercityBookingStatus = 'confirmed' | 'cancelled' | 'completed';

export interface IntercityCity {
  id: string;
  name: string;
  province: string;
}

export interface IntercityTrip {
  id: string;
  fromCityId: string;
  fromCityName: string;
  toCityId: string;
  toCityName: string;
  departureTime: number;
  estimatedArrivalTime?: number;
  vehicleType: IntercityVehicleType;
  operatorName: string;
  totalSeats: number;
  bookedSeats: number;
  farePerSeat: number;
  status: IntercityTripStatus;
  pickupPoint?: string;
  dropoffPoint?: string;
  driverId?: string;
  driverName?: string;
  driverPhone?: string;
  plateNumber?: string;
  notes?: string;
  createdAt: number;
}

export interface IntercityBooking {
  id: string;
  tripId: string;
  passengerId: string;
  passengerName: string;
  passengerPhone?: string;
  seatsBooked: number;
  fareTotal: number;
  farePerSeat: number;
  fromCityId: string;
  fromCityName: string;
  toCityId: string;
  toCityName: string;
  departureTime: number;
  estimatedArrivalTime?: number;
  vehicleType: IntercityVehicleType;
  operatorName: string;
  status: IntercityBookingStatus;
  paymentMethod: 'cash' | 'wallet';
  seatNumbers?: number[];
  pickupPoint?: string;
  dropoffPoint?: string;
  createdAt: number;
}

export interface IntercityMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: 'passenger' | 'driver' | 'admin';
  text: string;
  createdAt: number;
}

export const VEHICLE_TYPE_LABELS: Record<IntercityVehicleType, string> = {
  standard_ac: 'Standard AC',
  business_ac: 'Business AC',
  non_ac:      'Non-AC Economy',
  coaster:     'Coaster (14 seats)',
  suv:         'Private SUV',
  hiace:       'Hiace Van',
};

export const VEHICLE_TYPE_ICONS: Record<IntercityVehicleType, string> = {
  standard_ac: '🚌',
  business_ac: '🚍',
  non_ac:      '🚐',
  coaster:     '🚐',
  suv:         '🚙',
  hiace:       '🚐',
};

export const TRIP_STATUS_META: Record<IntercityTripStatus, { label: string; color: string }> = {
  scheduled:   { label: 'Scheduled',  color: '#3b82f6' },
  boarding:    { label: 'Boarding',   color: '#f59e0b' },
  in_progress: { label: 'En Route',   color: '#10b981' },
  completed:   { label: 'Completed',  color: '#8a8c8c' },
  cancelled:   { label: 'Cancelled',  color: '#ef4444' },
};

export const BOOKING_STATUS_META: Record<IntercityBookingStatus, { label: string; color: string }> = {
  confirmed:  { label: 'Confirmed',  color: '#10b981' },
  cancelled:  { label: 'Cancelled',  color: '#ef4444' },
  completed:  { label: 'Completed',  color: '#8a8c8c' },
};

// Daewoo/Faisal Movers calibrated fares (PKR per seat, one-way)
// standard_ac: ~PKR 2.8/km; business_ac: ~PKR 4.5/km; mountain routes add 40%
export const ROUTE_BASE_FARES: Record<string, { standard_ac: number; business_ac: number; non_ac: number }> = {
  // Major Punjab <> Federal routes
  'lahore_islamabad':         { standard_ac: 1100, business_ac: 1800, non_ac: 700  },
  'lahore_rawalpindi':        { standard_ac: 1050, business_ac: 1700, non_ac: 650  },
  'lahore_karachi':           { standard_ac: 3800, business_ac: 5800, non_ac: 2500 },
  'lahore_multan':            { standard_ac: 950,  business_ac: 1550, non_ac: 620  },
  'lahore_faisalabad':        { standard_ac: 620,  business_ac: 1000, non_ac: 400  },
  'lahore_sialkot':           { standard_ac: 480,  business_ac: 780,  non_ac: 310  },
  'lahore_gujranwala':        { standard_ac: 360,  business_ac: 580,  non_ac: 230  },
  'lahore_bahawalpur':        { standard_ac: 1100, business_ac: 1800, non_ac: 720  },
  // Federal <> KPK
  'islamabad_peshawar':       { standard_ac: 680,  business_ac: 1100, non_ac: 440  },
  'islamabad_abbottabad':     { standard_ac: 580,  business_ac: 940,  non_ac: 380  },
  'islamabad_mansehra':       { standard_ac: 680,  business_ac: 1100, non_ac: 440  },
  'islamabad_mingora':        { standard_ac: 850,  business_ac: 1380, non_ac: 550  },
  // Federal <> Northern (mountain premium)
  'islamabad_gilgit':         { standard_ac: 2500, business_ac: 3900, non_ac: 1600 },
  'islamabad_skardu':         { standard_ac: 3100, business_ac: 4800, non_ac: 2000 },
  'islamabad_hunza':          { standard_ac: 2800, business_ac: 4300, non_ac: 1800 },
  'islamabad_naran':          { standard_ac: 1100, business_ac: 1750, non_ac: 720  },
  'islamabad_kaghan':         { standard_ac: 1200, business_ac: 1900, non_ac: 780  },
  // Federal <> AJK
  'islamabad_muzaffarabad':   { standard_ac: 540,  business_ac: 880,  non_ac: 350  },
  'islamabad_mirpur_ajk':     { standard_ac: 650,  business_ac: 1050, non_ac: 420  },
  // Federal <> Karachi
  'islamabad_karachi':        { standard_ac: 4500, business_ac: 7000, non_ac: 2900 },
  // Sindh
  'karachi_hyderabad':        { standard_ac: 580,  business_ac: 940,  non_ac: 380  },
  'karachi_sukkur':           { standard_ac: 1500, business_ac: 2400, non_ac: 980  },
  'karachi_larkana':          { standard_ac: 1800, business_ac: 2900, non_ac: 1200 },
  // KPK internal
  'peshawar_mingora':         { standard_ac: 750,  business_ac: 1200, non_ac: 490  },
  'peshawar_abbottabad':      { standard_ac: 580,  business_ac: 940,  non_ac: 380  },
  'peshawar_di_khan':         { standard_ac: 1100, business_ac: 1750, non_ac: 720  },
  // Balochistan
  'islamabad_quetta':         { standard_ac: 3200, business_ac: 5000, non_ac: 2100 },
  'lahore_quetta':            { standard_ac: 2800, business_ac: 4400, non_ac: 1850 },
  'karachi_quetta':           { standard_ac: 2500, business_ac: 3900, non_ac: 1650 },
};

function bidirectional(
  src: Record<string, { standard_ac: number; business_ac: number; non_ac: number }>,
) {
  const result: typeof src = { ...src };
  for (const key of Object.keys(src)) {
    const [a, b] = key.split('_').reduce<string[]>((acc, seg, i, arr) => {
      // Try to split on known city IDs — just reverse the key parts at first underscore
      return acc;
    }, []);
    // Simpler: reverse by splitting on first city
    const parts = key.split('_');
    // Find where to split — city IDs have underscores too (rahim_yar_khan)
    // Just register both directions via the outer loop when needed
  }
  return result;
}

export function getRouteFare(
  fromId: string,
  toId: string,
  vehicleType: IntercityVehicleType,
): number {
  const key1 = `${fromId}_${toId}`;
  const key2 = `${toId}_${fromId}`;
  const entry = ROUTE_BASE_FARES[key1] ?? ROUTE_BASE_FARES[key2];
  if (!entry) return vehicleType === 'business_ac' ? 2000 : vehicleType === 'non_ac' ? 600 : 1200;
  return entry[vehicleType as 'standard_ac' | 'business_ac' | 'non_ac'] ?? entry.standard_ac;
}

export const PAKISTAN_CITIES: IntercityCity[] = [
  // Federal
  { id: 'islamabad',      name: 'Islamabad',          province: 'Federal'          },
  // Punjab
  { id: 'lahore',         name: 'Lahore',              province: 'Punjab'           },
  { id: 'rawalpindi',     name: 'Rawalpindi',          province: 'Punjab'           },
  { id: 'faisalabad',     name: 'Faisalabad',          province: 'Punjab'           },
  { id: 'gujranwala',     name: 'Gujranwala',          province: 'Punjab'           },
  { id: 'multan',         name: 'Multan',              province: 'Punjab'           },
  { id: 'sialkot',        name: 'Sialkot',             province: 'Punjab'           },
  { id: 'gujrat',         name: 'Gujrat',              province: 'Punjab'           },
  { id: 'bahawalpur',     name: 'Bahawalpur',          province: 'Punjab'           },
  { id: 'sargodha',       name: 'Sargodha',            province: 'Punjab'           },
  { id: 'rahim_yar_khan', name: 'Rahim Yar Khan',      province: 'Punjab'           },
  { id: 'jhang',          name: 'Jhang',               province: 'Punjab'           },
  { id: 'okara',          name: 'Okara',               province: 'Punjab'           },
  { id: 'sahiwal',        name: 'Sahiwal',             province: 'Punjab'           },
  { id: 'dg_khan',        name: 'Dera Ghazi Khan',     province: 'Punjab'           },
  { id: 'kasur',          name: 'Kasur',               province: 'Punjab'           },
  { id: 'wah_cantt',      name: 'Wah Cantonment',      province: 'Punjab'           },
  { id: 'attock',         name: 'Attock',              province: 'Punjab'           },
  { id: 'chakwal',        name: 'Chakwal',             province: 'Punjab'           },
  { id: 'jhelum',         name: 'Jhelum',              province: 'Punjab'           },
  { id: 'mianwali',       name: 'Mianwali',            province: 'Punjab'           },
  { id: 'khanewal',       name: 'Khanewal',            province: 'Punjab'           },
  { id: 'hafizabad',      name: 'Hafizabad',           province: 'Punjab'           },
  { id: 'narowal',        name: 'Narowal',             province: 'Punjab'           },
  { id: 'sheikhupura',    name: 'Sheikhupura',         province: 'Punjab'           },
  // Sindh
  { id: 'karachi',        name: 'Karachi',             province: 'Sindh'            },
  { id: 'hyderabad',      name: 'Hyderabad',           province: 'Sindh'            },
  { id: 'sukkur',         name: 'Sukkur',              province: 'Sindh'            },
  { id: 'larkana',        name: 'Larkana',             province: 'Sindh'            },
  { id: 'mirpur_khas',    name: 'Mirpur Khas',         province: 'Sindh'            },
  { id: 'nawabshah',      name: 'Nawabshah',           province: 'Sindh'            },
  { id: 'jacobabad',      name: 'Jacobabad',           province: 'Sindh'            },
  { id: 'khairpur',       name: 'Khairpur',            province: 'Sindh'            },
  // KPK
  { id: 'peshawar',       name: 'Peshawar',            province: 'KPK'              },
  { id: 'mardan',         name: 'Mardan',              province: 'KPK'              },
  { id: 'mingora',        name: 'Mingora (Swat)',       province: 'KPK'             },
  { id: 'abbottabad',     name: 'Abbottabad',          province: 'KPK'              },
  { id: 'mansehra',       name: 'Mansehra',            province: 'KPK'              },
  { id: 'kohat',          name: 'Kohat',               province: 'KPK'              },
  { id: 'di_khan',        name: 'Dera Ismail Khan',    province: 'KPK'              },
  { id: 'nowshera',       name: 'Nowshera',            province: 'KPK'              },
  { id: 'charsadda',      name: 'Charsadda',           province: 'KPK'              },
  { id: 'bannu',          name: 'Bannu',               province: 'KPK'              },
  { id: 'haripur',        name: 'Haripur',             province: 'KPK'              },
  { id: 'chitral',        name: 'Chitral',             province: 'KPK'              },
  { id: 'dir_upper',      name: 'Dir (Upper)',          province: 'KPK'             },
  { id: 'kalam',          name: 'Kalam',               province: 'KPK'              },
  { id: 'naran',          name: 'Naran',               province: 'KPK'              },
  { id: 'kaghan',         name: 'Kaghan',              province: 'KPK'              },
  // Balochistan
  { id: 'quetta',         name: 'Quetta',              province: 'Balochistan'      },
  { id: 'turbat',         name: 'Turbat',              province: 'Balochistan'      },
  { id: 'khuzdar',        name: 'Khuzdar',             province: 'Balochistan'      },
  { id: 'hub',            name: 'Hub',                 province: 'Balochistan'      },
  { id: 'chaman',         name: 'Chaman',              province: 'Balochistan'      },
  { id: 'zhob',           name: 'Zhob',                province: 'Balochistan'      },
  { id: 'gwadar',         name: 'Gwadar',              province: 'Balochistan'      },
  // AJK
  { id: 'muzaffarabad',   name: 'Muzaffarabad',        province: 'AJK'              },
  { id: 'mirpur_ajk',     name: 'Mirpur (AJK)',         province: 'AJK'             },
  { id: 'rawalakot',      name: 'Rawalakot',           province: 'AJK'              },
  { id: 'bagh',           name: 'Bagh',                province: 'AJK'              },
  { id: 'kotli',          name: 'Kotli',               province: 'AJK'              },
  // Gilgit-Baltistan (Northern Areas)
  { id: 'gilgit',         name: 'Gilgit',              province: 'Gilgit-Baltistan' },
  { id: 'skardu',         name: 'Skardu',              province: 'Gilgit-Baltistan' },
  { id: 'hunza',          name: 'Hunza (Karimabad)',   province: 'Gilgit-Baltistan' },
  { id: 'chilas',         name: 'Chilas',              province: 'Gilgit-Baltistan' },
  { id: 'ghanche',        name: 'Ghanche (Khaplu)',    province: 'Gilgit-Baltistan' },
  { id: 'astore',         name: 'Astore',              province: 'Gilgit-Baltistan' },
  { id: 'ghizer',         name: 'Ghizer (Gahkuch)',    province: 'Gilgit-Baltistan' },
];

export const POPULAR_CITY_IDS = [
  'islamabad', 'lahore', 'karachi', 'rawalpindi',
  'peshawar', 'multan', 'faisalabad', 'gilgit', 'abbottabad',
];
