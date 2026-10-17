/**
 * The raw material the local writer builds from — the half of writing that is
 * knowledge rather than language.
 *
 * `claude.ts` has one job the local engine cannot copy: inventing a sentence
 * nobody wrote down. What it can copy is everything that made those sentences
 * good, and most of that was never language in the first place — it was knowing
 * that a Lahore driver counts cash on his bonnet, that the rider's complaint is
 * surge pricing, that the intercity comparison is the bus. That knowledge is
 * written here once, by hand, per angle.
 *
 * Three rules this file keeps, because they are the ones a model kept for us:
 *
 * 1. **A number appears only if it is real.** Every line that names a figure
 *    declares the fact it needs in `needs`, and `compose.ts` drops the line
 *    when that fact is zero or missing. This is HARD_RULES #1 enforced in code
 *    rather than asked for in a prompt — and it matters more here than it did
 *    with Claude, because the platform's counters are still near zero and a
 *    template will happily print "Rs 0" where a model would have hesitated.
 * 2. **No competitor is named, ever** — HARD_RULES #2. The bus and "surge
 *    pricing" are the comparisons; no brand appears in this file, and that is
 *    deliberate rather than an oversight.
 * 3. **Nothing promises an income** — HARD_RULES #3. Lines describe how
 *    earnings work. None of them says what anybody will make.
 *
 * The hooks are written to score, not to read nicely in isolation: `lint.ts`
 * rewards a line of 5-12 words with a payload in the first three, a stakes
 * word, something checkable and the viewer addressed directly. Each line below
 * is built to that shape on purpose, which is why they look repetitive read
 * down the page and do not read that way one at a time in a feed.
 */

/** A fact key the writer may interpolate, and may not invent. */
export type FactKey =
  | 'averageFarePKR'
  | 'commissionRatePercent'
  | 'approvedDrivers'
  | 'totalTripsCompleted'
  | 'tripsLast7Days'
  | 'grossFaresLast7DaysPKR'
  | 'totalDriverPayoutPKR';

/** One candidate opening: the shape it came from, and what it costs in facts. */
export interface HookSeed {
  /** The playbook formula, by number and name, for the console and the plan. */
  formula: string;
  /** Placeholders in braces are filled from FACTS; see `compose.ts`. */
  text: string;
  /** Facts that must be present and non-zero, or this line is not used. */
  needs: FactKey[];
}

export interface AngleMaterial {
  label: string;
  /** Who the piece is about, in one concrete phrase. */
  who: string;
  /** The frustration this angle resolves. Filmable, not abstract. */
  pain: string;
  /** What Velocity Rides actually changes about it. */
  lever: string;
  /** Candidate openings, scored and chosen at write time. */
  hooks: HookSeed[];
  /** Filmable images, in the order a piece would use them. */
  scenes: string[];
  /** On-screen words, six at most, paired with the scenes by position. */
  overlays: string[];
  /** Caption body sentences. Joined and trimmed to fit, in this order. */
  body: string[];
  /**
   * The same ideas as `body`, but said out loud.
   *
   * These are separate from the caption prose and not a styling choice:
   * `lint.ts` times a voiceover at 165 words a minute and calls any beat over
   * four seconds a fault, so a spoken line runs to eleven words at the outside.
   * A caption sentence is routinely twice that. One of these lines carries a
   * name or a digit, because three beats in a row with nothing checkable in
   * them is its own fault.
   */
  spoken: string[];
  /**
   * The closing spoken line. It repeats a word from the hook on purpose — the
   * timer rewards a script whose last line loops back to its first, because a
   * rewatch is free reach. `compose.ts` checks the loop actually closed and
   * picks a different hook when it did not.
   */
  spokenClose: string;
  /**
   * Other closing lines, for when the first one does not loop back.
   *
   * The timer compares the last line to the *first sentence of the hook*, and
   * which hook won is not known when the material is written — so a single
   * closing line can only satisfy it for some of an angle's openings. Giving
   * the composer a choice is the same trick as everything else here: offer
   * candidates, let the critic pick. Angles whose one close already loops back
   * from every opening do not need these.
   */
  spokenCloseAlts?: string[];
  /** The one ask. Exactly one, because two asks lint as none. */
  cta: string;
  /** Phrases that belong in the spoken and on-screen copy. */
  keywords: string[];
  /** Sized the way the playbook asks: two niche, two mid, one broad. */
  tags: { niche: string[]; mid: string[]; broad: string[] };
  /** The query this piece should answer, in the words someone would type. */
  searchIntent: string;
}

/** Cities the brand films in, rotated so a fortnight is not all Lahore. */
export const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan'];

/** Intercity pairs that are real routes with real bus competition. */
export const ROUTES = [
  'Lahore to Islamabad',
  'Karachi to Hyderabad',
  'Lahore to Faisalabad',
  'Islamabad to Peshawar',
  'Lahore to Multan',
];

export const ANGLE_MATERIAL: Record<string, AngleMaterial> = {
  'driver-earnings': {
    label: 'What a driver takes home',
    who: 'a driver finishing a shift',
    pain: 'waiting a week to find out what the app kept',
    lever: 'commission comes off completed rides only, and the fare is cash in hand',
    hooks: [
      { formula: '3 Nobody Tells You', text: 'Nobody tells you the fare is already in your pocket.', needs: [] },
      {
        formula: '23 The Statistic',
        text: 'Only {rate} leaves your fare. Nobody touches the rest.',
        needs: ['commissionRatePercent'],
      },
      { formula: '5 Time Collapse', text: 'Weekly payouts are over. Your cash never leaves you.', needs: [] },
      {
        formula: '1 Cost Confession',
        text: '{rate} commission. You keep every other rupee, today.',
        needs: ['commissionRatePercent'],
      },
      { formula: '20 Permission', text: 'You do not need a payout date any more.', needs: [] },
      {
        formula: '6 The Receipt',
        text: '{weekTrips} rides last week. Every fare paid in cash.',
        needs: ['tripsLast7Days'],
      },
      { formula: '2 Negative Command', text: 'Stop waiting on a payout. Your fare is cash.', needs: [] },
    ],
    scenes: [
      'A driver in his thirties leaning on the bonnet of a white Suzuki Alto on a Lahore side street at golden hour, counting a folded stack of rupee notes, lime-green phone case on the bonnet beside him',
      'Close over the shoulder on the phone: the ride complete, the fare shown, his thumb resting on the screen',
      'The same driver sliding the notes into his shirt pocket and looking off down the street, unhurried',
      'Wide from across the road: the car pulling away past a chai dhaba, one lime sign catching the last light',
    ],
    overlays: ['The fare is yours', 'Commission only on completed rides', 'Cash, on the spot', 'Velocity Rides'],
    body: [
      'Commission comes off a completed ride and nothing else.',
      'The passenger pays in cash, the driver keeps it, and nothing waits for a weekly transfer.',
      'No surge, no bidding war against the app — the rider names a fare and the driver decides whether to take it.',
    ],
    spoken: [
      'Commission comes off completed rides only.',
      'On Velocity Rides it comes off the ride, not off you.',
      'The passenger pays you in cash, on the spot.',
      'Cash, EasyPaisa or JazzCash in Lahore and everywhere.',
      'Nothing waits for a weekly transfer.',
    ],
    spokenClose: 'Your fare, in your own pocket.',
    cta: 'Download Velocity Rides and drive on it tomorrow.',
    keywords: ['driver commission', 'cash fare', 'ride hailing driver Pakistan', 'daily earnings'],
    tags: { niche: ['lahoredrivers', 'velocityrides'], mid: ['ridehailing', 'driverlife'], broad: ['pakistan'] },
    searchIntent: 'how much commission does a ride hailing app take from a driver in Pakistan',
  },

  'fleet-owner-maths': {
    label: 'Owning cars and putting drivers on them',
    who: 'an owner with three cars and three drivers',
    pain: 'running several cars from a notebook and a WhatsApp group',
    lever: 'a fleet portal that shows every car and every driver on one screen',
    hooks: [
      { formula: '9 The Steal', text: 'Steal this: three cars, one screen, no notebook.', needs: [] },
      { formula: '17 Head To Head', text: 'Two cars or ten, your portal never changes.', needs: [] },
      { formula: '3 Nobody Tells You', text: 'Nobody tells you a notebook cannot run three cars.', needs: [] },
      { formula: '17 Head To Head', text: 'One car or ten, your portal does not change.', needs: [] },
      { formula: '14 The Callout', text: 'Fleet owners: your drivers are costing you paperwork.', needs: [] },
      { formula: '20 Permission', text: 'You do not need an office to run a fleet.', needs: [] },
      { formula: '4 The Replacement', text: 'A WhatsApp group never showed you one car honestly.', needs: [] },
    ],
    scenes: [
      'Three white hatchbacks parked nose-in on a residential Karachi street at early morning, three drivers standing by the open doors, the owner on the kerb with a phone',
      'Over the shoulder on the phone: a fleet list, three cars, each with a driver name beside it, lime accents on the active row',
      'The owner handing a key to one driver, both laughing, the other two cars already pulling out',
      'Wide at dusk: the same spot empty, one lime-lit sign on the wall behind',
    ],
    overlays: ['Three cars, one screen', 'Every driver, every ride', 'No notebook', 'Velocity Rides Pro'],
    body: [
      'The Velocity Rides Pro portal puts every car and every driver you run on one screen.',
      'You see which car is working, who is on it and what it completed, without ringing anybody.',
      'Owners with two to ten vehicles are the ones it was built for.',
    ],
    spoken: [
      'Every car you run, on one screen.',
      'The Velocity Rides Pro portal takes two to ten cars.',
      'You see who is driving right now.',
      'No notebook, no WhatsApp group, no ringing around.',
      'In Karachi or Lahore, the portal is identical.',
    ],
    spokenClose: 'Your fleet, your cars, one screen.',
    cta: 'Download Velocity Rides and open the fleet portal.',
    keywords: ['fleet portal', 'car owner Pakistan', 'rent a car to driver', 'fleet management'],
    tags: { niche: ['fleetowners', 'velocityridespro'], mid: ['carinvestment', 'ridehailing'], broad: ['pakistan'] },
    searchIntent: 'how to manage several cars and drivers on a ride hailing app in Pakistan',
  },

  'rider-savings': {
    label: 'The rider names the fare',
    who: 'a rider standing on a kerb at peak hour',
    pain: 'a price that doubles because it is raining',
    lever: 'the rider offers a fare and drivers bid on it, so there is no surge',
    hooks: [
      { formula: '2 Negative Command', text: 'Stop accepting a surge price. Name your own fare.', needs: [] },
      { formula: '20 Permission', text: 'You never have to accept a doubled fare again.', needs: [] },
      { formula: '12 The Objection', text: '"Rain means double." Not when you set the price.', needs: [] },
      {
        formula: '23 The Statistic',
        text: 'Rs {fare} is the average fare. You still set yours.',
        needs: ['averageFarePKR'],
      },
      { formula: '3 Nobody Tells You', text: 'Nobody tells you the price was never fixed.', needs: [] },
      { formula: '5 Time Collapse', text: 'Surge pricing is not a weather problem. It is a choice.', needs: [] },
      { formula: '26 The Superlative', text: 'The only fare that matters is the one you offered.', needs: [] },
    ],
    scenes: [
      'A young woman under a shop awning on a wet Lahore evening, phone up, headlights streaking past on the road behind her',
      'Close on the phone: she types a fare into the offer field, the lime button lit under her thumb',
      'A white car pulls in, the driver leans over and nods once; she opens the back door',
      'From inside the car looking out through a rain-streaked window at the street sliding past',
    ],
    overlays: ['You name the fare', 'Drivers bid on it', 'No surge, ever', 'Velocity Rides'],
    body: [
      'You offer what the ride is worth to you, and drivers nearby decide whether to take it.',
      'Rain, rush hour and a cricket match do not change the rules — there is no surge multiplier to apply.',
      'Pay in cash, EasyPaisa, JazzCash or by bank transfer.',
    ],
    spoken: [
      'You offer what the ride is worth to you.',
      'On Velocity Rides nobody prices your ride for you.',
      'Drivers nearby decide whether to take it.',
      'Cash, EasyPaisa or JazzCash in Lahore and everywhere.',
      'No surge multiplier, whatever the weather does.',
    ],
    spokenClose: 'Your fare, your price.',
    cta: 'Download Velocity Rides and offer your own fare.',
    keywords: ['name your own fare', 'no surge pricing', 'cheap ride Lahore', 'offer your fare'],
    tags: { niche: ['lahoretraffic', 'velocityrides'], mid: ['ridehailing', 'commute'], broad: ['pakistan'] },
    searchIntent: 'ride hailing app where you set your own fare in Pakistan',
  },

  safety: {
    label: 'Who is actually driving',
    who: 'a rider getting into a car after dark',
    pain: 'not knowing who is behind the wheel',
    lever:
      'every driver has a verified CNIC, the trip can be shared live, and a rider can require a female driver',
    hooks: [
      { formula: '3 Nobody Tells You', text: 'Nobody tells you a photo is not an identity check.', needs: [] },
      { formula: '14 The Callout', text: 'Every driver verified against a CNIC. Not a selfie.', needs: [] },
      { formula: '10 If This, Then Watch', text: 'If you ride after dark, share the trip live.', needs: [] },
      { formula: '20 Permission', text: 'You can require a female driver before you book.', needs: [] },
      { formula: '2 Negative Command', text: 'Never guess who is driving. Check the CNIC.', needs: [] },
      { formula: '24 The Reveal', text: 'Your trip link works on any phone, no app needed.', needs: [] },
    ],
    scenes: [
      'A woman in her twenties on an Islamabad street at dusk, phone held low, a white car waiting with its indicator on',
      'Close on the phone: the driver card, name, photo and a verified CNIC tick in lime',
      'Her thumb sending a live trip link into a family chat, the map already moving',
      'Through the rear window: the car joining traffic on a lit avenue',
    ],
    overlays: ['CNIC verified', 'Share the trip live', 'Prefer a female driver', 'Velocity Rides'],
    body: [
      "Velocity Rides verifies every driver's CNIC before they take a ride, and checks the car papers with it.",
      'A live trip link opens as a web page on anyone’s phone, so the person you sent it to does not need the app.',
      'Riders who want a female driver can require one rather than hope for one.',
    ],
    spoken: [
      'Every driver is checked against a CNIC first.',
      'The Velocity Rides check covers the car papers too.',
      'Send the live trip link to anyone you like.',
      'Rescue 1122 and Police 15 are one tap away.',
      'Require a female driver instead of hoping for one.',
    ],
    spokenClose: 'Know your driver before you ride.',
    cta: 'Download Velocity Rides and share your next trip.',
    keywords: ['CNIC verified driver', 'share live trip', 'female driver option', 'safe ride Pakistan'],
    tags: { niche: ['womensafety', 'velocityrides'], mid: ['ridesafety', 'ridehailing'], broad: ['pakistan'] },
    searchIntent: 'how to check a ride hailing driver is verified in Pakistan',
  },

  'how-it-works': {
    label: 'Three taps to a ride',
    who: 'someone who has never used a ride-hailing app',
    pain: 'assuming an app is harder than flagging a rickshaw',
    lever: 'pick up, name a fare, a driver accepts',
    hooks: [
      { formula: '5 Time Collapse', text: 'Three taps. No haggling. Your ride is booked.', needs: [] },
      { formula: '20 Permission', text: 'You do not need to know the fare before you ask.', needs: [] },
      { formula: '18 Cold Open Demo', text: 'Watch this. Pickup, your fare, a driver accepts.', needs: [] },
      { formula: '10 If This, Then Watch', text: 'If you have never booked a ride, watch this.', needs: [] },
      { formula: '2 Negative Command', text: 'Stop flagging cars down. Offer a fare instead.', needs: [] },
      { formula: '3 Nobody Tells You', text: 'Nobody tells you the app never picks your price.', needs: [] },
    ],
    scenes: [
      'A man in his fifties on a Multan street holding a phone at arm’s length, squinting at it, a shop front behind him',
      'Phone screen filling the frame: a pickup pin dropped on the map, one lime tap',
      'Phone screen: a fare typed in, then a driver card sliding up with a photo and a car',
      'The same man in the back seat, looking out of the window, phone away',
    ],
    overlays: ['1. Where to', '2. Your fare', '3. Driver accepts', 'That is the whole app'],
    body: [
      'On Velocity Rides you set where you are going, say what you will pay, and wait for a driver to take it.',
      'There is no price to accept or refuse, because the price came from you.',
      'Cash is a normal way to pay, not a fallback.',
    ],
    spoken: [
      'Tap one, set where you are going.',
      'Tap two, type the fare you will pay.',
      'Tap three, a driver accepts it.',
      'No app on Velocity Rides ever picked your price.',
      'Cash works in Lahore and everywhere else.',
    ],
    spokenClose: 'Your fare, three taps.',
    // One sentence each, deliberately: the timer compares the LAST sentence of
    // the script, so a two-sentence close throws away the word that was doing
    // the looping.
    spokenCloseAlts: ['No more flagging cars down.', 'You never need the fare first.'],
    cta: 'Download Velocity Rides and book your first ride.',
    keywords: ['how to book a ride', 'first ride', 'ride hailing for beginners', 'book a car Pakistan'],
    tags: { niche: ['multan', 'velocityrides'], mid: ['howto', 'ridehailing'], broad: ['pakistan'] },
    searchIntent: 'how to book a ride on a ride hailing app in Pakistan step by step',
  },

  pooling: {
    label: 'Splitting a ride',
    who: 'two strangers going the same way at the same hour',
    pain: 'paying for a whole car to carry one person',
    lever: 'a shared ride splits the fare per seat, at a fixed price set before anyone joins',
    hooks: [
      { formula: '3 Nobody Tells You', text: 'Nobody tells you a whole car costs you three seats.', needs: [] },
      { formula: '2 Negative Command', text: 'Stop paying for empty seats you never sat in.', needs: [] },
      { formula: '20 Permission', text: 'You do not need the whole car to get to work.', needs: [] },
      { formula: '11 Numbered With A Favourite', text: 'Three seats, one route, your fare never moves.', needs: [] },
      { formula: '17 Head To Head', text: 'One rider or three, your seat price is fixed.', needs: [] },
      { formula: '10 If This, Then Watch', text: 'If you commute the same road daily, share it.', needs: [] },
    ],
    scenes: [
      'Morning light on a Karachi arterial road, three people getting into one white sedan at a marked pickup point',
      'Inside from the front seat: two riders in the back, one beside the driver, all looking at their phones, easy silence',
      'Phone close-up: a shared ride card, the seat fare in lime, two seats already taken',
      'The car merging into morning traffic, shot from a flyover above',
    ],
    overlays: ['Share the road', 'Fixed fare per seat', 'Same route, same hour', 'Velocity Rides'],
    body: [
      'A Velocity Rides shared ride carries people going the same way and charges each seat a fixed fare.',
      'The seat price is set before anybody joins, so it does not move when the car fills.',
      'Riders can choose to share only with their own gender before any booking is made.',
    ],
    spoken: [
      'A shared ride carries people going your way.',
      'Each seat pays one fixed fare.',
      'On Velocity Rides it is set before anybody joins.',
      'So it never moves when the car fills.',
      'Commuters in Karachi share the same road every morning.',
    ],
    spokenClose: 'Shared seats, one fixed fare each.',
    cta: 'Download Velocity Rides and take a shared seat.',
    keywords: ['shared ride', 'split the fare', 'carpool Pakistan', 'ride sharing per seat'],
    tags: { niche: ['karachicommute', 'velocityrides'], mid: ['ridesharing', 'commute'], broad: ['pakistan'] },
    searchIntent: 'how does sharing a ride and splitting the fare work in Pakistan',
  },

  intercity: {
    label: 'City to city, by seat',
    who: 'someone travelling between two cities on a Friday',
    pain: 'a bus timetable that ignores when you actually need to leave',
    lever: 'intercity seats leave when the car fills, door to door',
    hooks: [
      { formula: '17 Head To Head', text: '{route} by seat. You never wait for a timetable.', needs: [] },
      { formula: '20 Permission', text: 'You do not need a bus terminal to leave town.', needs: [] },
      { formula: '2 Negative Command', text: 'Stop timing your Friday around a bus schedule.', needs: [] },
      { formula: '3 Nobody Tells You', text: 'Nobody tells you a seat can leave from your gate.', needs: [] },
      { formula: '5 Time Collapse', text: 'Terminal, queue, wait. Or a seat at your door.', needs: [] },
      { formula: '10 If This, Then Watch', text: 'If you travel {route} often, book the seat.', needs: [] },
    ],
    scenes: [
      'A young man with a duffel bag outside a house gate on a quiet morning street, a white sedan pulling up to him',
      'Motorway from inside the car: the lane markings, open road, fields beyond the barrier',
      'Phone close-up: an intercity seat card, the route and the departure in lime',
      'Arrival on a city street at dusk, the bag coming out of the boot',
    ],
    overlays: ['City to city', 'By the seat', 'Door to door', 'Velocity Rides'],
    body: [
      'Intercity seats run between cities and pick up where you are instead of at a terminal.',
      'You book one seat, not a whole car, and the fare for that seat is fixed when you book it.',
      'Luggage goes in the boot and the route is the motorway, not a tour of every stop.',
    ],
    spoken: [
      'An intercity seat picks you up where you are.',
      'Lahore to Islamabad, door to door.',
      'You book one seat, not the whole car.',
      'On Velocity Rides that seat fare is fixed when you book.',
      'Motorway, not a stop in every town.',
    ],
    spokenClose: 'One seat, door to door.',
    cta: 'Download Velocity Rides and book an intercity seat.',
    keywords: ['intercity seat', 'Lahore to Islamabad', 'city to city travel', 'book a seat'],
    tags: { niche: ['lahoreislamabad', 'velocityrides'], mid: ['intercity', 'travelpakistan'], broad: ['pakistan'] },
    searchIntent: 'book a single seat from Lahore to Islamabad door to door',
  },

  couriers: {
    label: 'Sending a parcel',
    who: 'a shopkeeper with one box and no van',
    pain: 'a courier office that closes before you can get there',
    lever: 'a rider already going that way takes the parcel',
    hooks: [
      { formula: '4 The Replacement', text: 'A courier office never stayed open for your box.', needs: [] },
      { formula: '3 Nobody Tells You', text: 'Nobody tells you a rider is already going there.', needs: [] },
      { formula: '2 Negative Command', text: 'Stop queuing at a courier counter. Send it now.', needs: [] },
      { formula: '20 Permission', text: 'You do not need a van to move one box.', needs: [] },
      { formula: '5 Time Collapse', text: 'Tomorrow at a counter, or across {city} tonight.', needs: [] },
      { formula: '14 The Callout', text: 'Shopkeepers: your parcel does not need a warehouse.', needs: [] },
    ],
    scenes: [
      'A shopkeeper in a narrow Rawalpindi market handing a taped cardboard box through a car window, shutters half down around him',
      'Close on the box going onto the back seat beside a lime-trimmed phone mount',
      'Phone screen: a courier booking, pickup and drop pins on the map',
      'The car threading out of the market lane into evening traffic',
    ],
    overlays: ['One box, one ride', 'Across the city tonight', 'No counter, no queue', 'Velocity Rides'],
    body: [
      'A courier booking sends a parcel with a driver who is already making that trip.',
      'You set the pickup and the drop, and the fare works the same way a ride does.',
      'It is for the one box that does not justify a van.',
    ],
    spoken: [
      'A driver already making that trip takes the parcel.',
      'You set the pickup and the drop.',
      'On Velocity Rides it is priced like a ride.',
      'No counter, no queue, no closing time.',
      'One box across Rawalpindi tonight.',
    ],
    spokenClose: 'Your parcel, your courier, tonight.',
    cta: 'Download Velocity Rides and send a parcel.',
    keywords: ['send a parcel', 'same day courier', 'courier Rawalpindi', 'parcel delivery app'],
    tags: { niche: ['rawalpindibazaar', 'velocityrides'], mid: ['courier', 'smallbusiness'], broad: ['pakistan'] },
    searchIntent: 'same day parcel delivery across the city in Pakistan',
  },

  'partner-program': {
    label: 'Earning from the commission',
    who: 'someone whose phone is full of drivers and riders',
    pain: 'introducing people to things and never seeing anything for it',
    lever: 'partners earn a share of Velocity Rides’ commission, not a cut of anybody’s fare',
    hooks: [
      { formula: '3 Nobody Tells You', text: 'Nobody tells you referrals can pay you for years.', needs: [] },
      {
        formula: '23 The Statistic',
        text: 'We charge {rate}. Partners earn a share of that.',
        needs: ['commissionRatePercent'],
      },
      { formula: '20 Permission', text: 'You do not need a shop to be a partner.', needs: [] },
      { formula: '9 The Steal', text: 'Steal this: your contacts are already the business.', needs: [] },
      { formula: '12 The Objection', text: '"Referrals pay once." Not a share of commission.', needs: [] },
      { formula: '20 Permission', text: 'Your referrals never paid. Our commission now does.', needs: [] },
      { formula: '2 Negative Command', text: 'Stop introducing drivers for free. Partner instead.', needs: [] },
    ],
    scenes: [
      'A man at a roadside tea stall showing his phone to two drivers, all three leaning in, cars parked behind',
      'Phone close-up: a partner dashboard, a list of joined drivers, a lime figure at the top',
      'A handshake over the tea cups, unforced, mid-laugh',
      'Wide: the stall at dusk, three cars pulling away in different directions',
    ],
    overlays: ['Bring drivers and riders', 'Earn from our commission', 'Not from their fare', 'Earn with Velocity'],
    body: [
      'Partners earn a percentage of the commission Velocity Rides charges, not a cut of any driver’s fare.',
      'The driver’s earnings and the rider’s fare are untouched by it, which is the whole design.',
      'You can see who you brought on and what they have done in the partner dashboard.',
    ],
    spoken: [
      'Partners earn from the commission we charge.',
      'Never from a driver fare. That stays whole.',
      'A Velocity Rides partner earns from our own cut.',
      'You watch who you brought on in the dashboard.',
      'Earn with Velocity sits inside the app.',
    ],
    spokenClose: 'Your referrals, a share of the commission.',
    cta: 'Download Velocity Rides and open Earn with Velocity.',
    keywords: ['partner programme', 'referral earnings', 'earn with Velocity', 'bring drivers'],
    tags: { niche: ['earnwithvelocity', 'velocityrides'], mid: ['sidehustle', 'referral'], broad: ['pakistan'] },
    searchIntent: 'how to earn by referring drivers to a ride hailing app in Pakistan',
  },

  'city-spotlight': {
    label: 'One city, its roads and its drivers',
    who: 'the drivers working one city',
    pain: 'an app that treats every city like the same grid',
    lever: 'routes, pickup points and drivers that are actually local',
    hooks: [
      { formula: '14 The Callout', text: '{city} drivers know the road the map does not.', needs: [] },
      { formula: '3 Nobody Tells You', text: 'Nobody tells you {city} has its own rush hour.', needs: [] },
      { formula: '16 The Verbatim Question', text: '"Does it even work in {city}?" You tell us.', needs: [] },
      {
        formula: '6 The Receipt',
        text: '{drivers} verified drivers. Ask one about {city}.',
        needs: ['approvedDrivers'],
      },
      { formula: '26 The Superlative', text: 'The fastest road out of {city} is never the main one.', needs: [] },
      { formula: '20 Permission', text: 'Your {city} driver never needs the map.', needs: [] },
      { formula: '24 The Reveal', text: 'This is {city}, driven by people who live in it.', needs: [] },
    ],
    scenes: [
      'A wide establishing shot of a recognisable city artery at golden hour, traffic flowing, a white car in the near lane',
      'A driver leaning out of his window talking to another driver at a red light, both relaxed',
      'Phone close-up: a pickup point named after a local landmark rather than a coordinate',
      'The same street after dark, lights on, one lime sign in frame',
    ],
    overlays: ['Driven locally', 'Real pickup points', 'Roads we actually use', 'Velocity Rides'],
    body: [
      'Pickup points are named after places people actually say out loud, not coordinates.',
      'The drivers working a city live in it, which is why the route they choose is rarely the obvious one.',
      'Every one of them is verified against a CNIC before they take a ride.',
    ],
    spoken: [
      'Pickup points are named after places people say.',
      'The drivers working {city} live in {city}.',
      'They know the road the map does not.',
      'Every one is checked against a CNIC.',
      'Rush hour in {city} is its own animal.',
    ],
    spokenClose: 'Driven by {city} people, for {city} roads.',
    cta: 'Download Velocity Rides and ride your own city.',
    keywords: ['local drivers', 'city pickup points', 'ride hailing city', 'local routes'],
    tags: { niche: ['citylife', 'velocityrides'], mid: ['ridehailing', 'commute'], broad: ['pakistan'] },
    searchIntent: 'is there a ride hailing app with local drivers in my city in Pakistan',
  },
};

/**
 * The angle used when the rotation lands on something this file has never
 * heard of — an admin can type any angle into the console, and a desk that
 * refuses an unknown word is worse than one that writes the brand's plainest
 * piece about it.
 */
export const GENERIC_ANGLE: AngleMaterial = {
  label: 'Velocity Rides',
  who: 'a rider and a driver agreeing a fare',
  pain: 'a price decided by an app neither of them works for',
  lever: 'the rider offers a fare, drivers bid, and cash is a normal way to pay',
  hooks: [
    { formula: '2 Negative Command', text: 'Stop accepting a price you never agreed to.', needs: [] },
    { formula: '3 Nobody Tells You', text: 'Nobody tells you the fare was always negotiable.', needs: [] },
    { formula: '20 Permission', text: 'You do not need an app to set your price.', needs: [] },
    {
      formula: '23 The Statistic',
      text: 'Only {rate} leaves the fare. The driver keeps it.',
      needs: ['commissionRatePercent'],
    },
  ],
  scenes: [
    'A driver and a rider at a car window on a Lahore street at golden hour, agreeing something with a nod',
    'Phone close-up: a fare offer, the lime button under a thumb',
    'The car pulling away into traffic, shot from the kerb',
  ],
  overlays: ['You name the fare', 'Drivers bid on it', 'Velocity Rides'],
  body: [
    'The rider offers a fare and drivers nearby decide whether to take it.',
    'There is no surge multiplier, and cash is a first-class way to pay.',
  ],
  spoken: [
    'The rider offers a fare they think is fair.',
    'Drivers nearby decide whether to take it.',
    'On Velocity Rides nobody else sets that price.',
    'Cash is a normal way to pay.',
    'No surge in Lahore, Karachi or anywhere.',
  ],
  spokenClose: 'Your fare, your price.',
  cta: 'Download Velocity Rides and offer your own fare.',
  keywords: ['name your own fare', 'no surge pricing', 'ride hailing Pakistan'],
  tags: { niche: ['velocityrides', 'lahore'], mid: ['ridehailing', 'commute'], broad: ['pakistan'] },
  searchIntent: 'ride hailing app in Pakistan where you name your own fare',
};

/** The material for an angle, falling back rather than failing. */
export function materialFor(angle: string): AngleMaterial {
  return ANGLE_MATERIAL[angle] ?? GENERIC_ANGLE;
}
