/* Mock data for the UNWIRED prototype. Shapes mirror the snapshot's precomputed
   per-work projection (redesign §12.3): canonical tags already collapsed,
   primary ship/collection as resolved GROUP names, card fields flattened. No API,
   no real epubs — this is design fixture data only. */

export type ReadStatus = 'Unread' | 'Read' | 'DNF'
export type Rating = 'General' | 'Teen' | 'Mature' | 'Explicit' | 'Not Rated'
export type Availability = 'live' | 'deleted' | 'locked' | 'n/a'

export type Category =
  | 'Fandom' | 'Relationship' | 'Character'
  | 'Trait'      // property-group bundle (§6.3.1) — a filterable roll-up of tags
  | 'Identity'   // Adopted 2026-06-14 (real-data audit still planned): what a
                 //   character IS in this AU — species/role/state (Vampire X,
                 //   Human Y, Trans Z). Distinct from Character (who) and
                 //   Universe (world framing).
  | 'Universe' | 'Content' | 'Trope' | 'Dynamics' | 'Mood' | 'Structure'
  | 'Other' | 'Rating'

/* `grouped` marks a canonical chip that collapses synonyms (§6.3.1) — shows a ◇.
   `synonyms` is how many raw tags fold into it (display only). */
export type Tag = { name: string; category: Category; grouped?: boolean; synonyms?: number }

export type Work = {
  workId: number
  title: string
  authors: string[]
  primaryShip: string | null      // resolved GROUP name, null = gen
  primaryCollection: string | null
  wordcount: number
  chapterCount?: number
  isComplete?: boolean
  rating: Rating
  readStatus: ReadStatus
  isFavorite: boolean
  pinned: boolean
  availability: Availability
  // Snapshot-projection fields (§12.3) the card may surface later (e.g. an
  // "Added" date, a source link). Optional in the fixtures; not all cards show
  // them today. "View on AO3" gates on source=ao3 + availability=live (§5).
  source?: 'ao3' | 'pre_ao3'
  sourceUrl?: string
  language?: string
  dateAdded?: string              // human display string (mock)
  dateRead?: string | null
  summary: string
  personalNotes?: string | null     // user's freeform private note (shown on card)
  tags: Tag[]                       // effective canonical tags, mixed categories
  series?: {
    name: string
    index: number
    total: number
    siblings: Work[]               // full works (no nested series) so a row can
                                   //   expand into a real card
    matchIds: number[]             // which siblings match the active filter
  }
}

const t = (name: string, category: Category): Tag => ({ name, category })
const tg = (name: string, category: Category, synonyms?: number): Tag =>
  ({ name, category, grouped: true, synonyms })

/* ---- Series siblings (full works, deliberately no nested series) ---------- */
const sibA: Work = {
  workId: 39882000, title: 'A Shorter Distance', authors: ['ironwrites', 'saltflats'],
  primaryShip: 'Steve/Tony', primaryCollection: 'MCU', wordcount: 41200,
  rating: 'Teen', readStatus: 'Read', isFavorite: false, pinned: false, availability: 'live',
  summary: 'Before the war that didn’t happen, there was a winter that did. The prequel: how Tony and Steve learned to stand in the same room.',
  tags: [t('Marvel Cinematic Universe', 'Fandom'), t('Steve Rogers/Tony Stark', 'Relationship'), t('Pre-Slash', 'Structure'), t('Slow Burn', 'Structure'), t('Angst', 'Mood')],
}
const sibSelf: Work = {
  workId: 39882011, title: 'The Long Way Down', authors: ['ironwrites', 'saltflats'],
  primaryShip: 'Steve/Tony', primaryCollection: 'MCU', wordcount: 213400,
  rating: 'Explicit', readStatus: 'Read', isFavorite: true, pinned: false, availability: 'live',
  dateAdded: '10 Feb 2026', dateRead: '5 Mar 2026',
  summary: 'A canon-divergent retelling where Tony never builds the gauntlet, and Steve has to decide what winning is actually worth.',
  tags: [t('Marvel Cinematic Universe', 'Fandom'), t('Steve Rogers/Tony Stark', 'Relationship'), t('Canon Divergence', 'Universe'), t('Enemies to Lovers', 'Trope'), t('Angst', 'Mood'), t('Slow Burn', 'Structure')],
}
const sibC: Work = {
  workId: 39882044, title: 'Home, Eventually', authors: ['ironwrites', 'saltflats'],
  primaryShip: 'Steve/Tony', primaryCollection: 'MCU', wordcount: 98700,
  rating: 'Mature', readStatus: 'Unread', isFavorite: false, pinned: false, availability: 'live',
  summary: 'The aftermath nobody writes about: paperwork, physical therapy, and learning to share a bathroom. The series finale.',
  tags: [t('Marvel Cinematic Universe', 'Fandom'), t('Steve Rogers/Tony Stark', 'Relationship'), t('Domestic Fluff', 'Mood'), t('Recovery', 'Trope'), t('Established Relationship', 'Dynamics')],
}

/* ---- Dense, realistic works (long summary + many tags) -------------------- */
const denseTags1: Tag[] = [
  t('Marvel Cinematic Universe', 'Fandom'),
  t('Captain America (Movies)', 'Fandom'),
  t('James "Bucky" Barnes/Steve Rogers', 'Relationship'),
  t('Bucky Barnes', 'Character'),
  t('Steve Rogers', 'Character'),
  t('Sam Wilson', 'Character'),
  t('Natasha Romanov', 'Character'),
  t('Alpha/Beta/Omega Dynamics', 'Trope'),
  t('Omega Bucky Barnes', 'Identity'),
  t('Alpha Steve Rogers', 'Identity'),
  t('Hurt/Comfort', 'Mood'),
  t('Angst with a Happy Ending', 'Mood'),
  t('Slow Burn', 'Structure'),
  t('PTSD', 'Content'),
  t('Recovery', 'Trope'),
  t('Found Family', 'Trope'),
  t('Mutual Pining', 'Dynamics'),
  t('Touch-Starved', 'Dynamics'),
  t('Period-Typical Attitudes', 'Universe'),
  t('Eventual Smut', 'Content'),
]

const denseWork1: Work = {
  workId: 44120999,
  title: 'The Weight of Quiet Mornings',
  authors: ['saltandsteel'],
  primaryShip: 'Bucky/Steve',
  primaryCollection: 'MCU',
  wordcount: 487300,
  rating: 'Explicit',
  readStatus: 'Unread',
  isFavorite: true,
  pinned: true,
  availability: 'live',
  source: 'ao3',
  sourceUrl: 'https://archiveofourown.org/works/44120999',
  language: 'English',
  dateAdded: '12 May 2026',
  dateRead: null,
  summary:
    'Seventy years out of the ice, Bucky Barnes has gotten very good at three things: making coffee before dawn, leaving rooms before anyone notices, and not wanting things he can’t have. Steve Rogers, infuriatingly, is none of those things — he wants loudly, constantly, and mostly in Bucky’s direction. ' +
    'What starts as a wary truce in a too-small Brooklyn apartment becomes something slower and stranger: shared groceries, a standing Thursday-night argument about jazz, the careful choreography of two damaged people learning the shape of each other’s mornings. ' +
    'Neither of them is built for easy. But maybe, between the nightmares and the slow thaw of a body that finally feels safe, easy isn’t the point. Maybe staying is. A novel-length study of recovery, scent, and the small domestic mercies that make a life.',
  tags: denseTags1,
}

const denseWork2: Work = {
  workId: 43771204,
  title: 'No Gods, Only Highways',
  authors: ['emberlight', 'thrushsong'],
  primaryShip: 'Geralt/Jaskier',
  primaryCollection: 'The Witcher',
  wordcount: 162540,
  rating: 'Mature',
  readStatus: 'Read',
  isFavorite: false,
  pinned: false,
  availability: 'live',
  source: 'ao3',
  sourceUrl: 'https://archiveofourown.org/works/43771204',
  language: 'English',
  dateAdded: '28 Mar 2026',
  dateRead: '15 Apr 2026',
  summary:
    'A modern road-trip AU in which Geralt drives a tow truck across three states, Jaskier is a washed-up indie musician with a dead phone and worse luck, and the two of them are very bad at admitting that the long way is the only way either of them wants to go. ' +
    'Diners, motels, a dog that adopts them somewhere outside of Denver, and the slow accumulation of a thousand small choices that look, in the rear-view mirror, a lot like falling in love.',
  tags: [
    t('The Witcher (TV)', 'Fandom'),
    t('Geralt z Rivii | Geralt of Rivia/Jaskier | Dandelion', 'Relationship'),
    t('Geralt of Rivia', 'Character'),
    t('Jaskier | Dandelion', 'Character'),
    t('Modern AU', 'Universe'),
    t('Road Trips', 'Trope'),
    t('Idiots to Lovers', 'Trope'),
    t('Slow Burn', 'Structure'),
    t('Fluff and Angst', 'Mood'),
    t('Mutual Pining', 'Dynamics'),
    t('Found Family', 'Trope'),
    t('Hurt/Comfort', 'Mood'),
    t('Getting Together', 'Trope'),
  ],
}

/* Modeled directly on a real AO3 work (the user's screenshot) to stress-test
   density: ~40 tags across every category + a multi-paragraph summary. */
const bornToBurn: Work = {
  workId: 45992100,
  title: 'Born to Burn',
  authors: ['Yoonmincraze'],
  primaryShip: 'Han/Lee Minho',
  primaryCollection: 'Stray Kids',
  wordcount: 215109,
  chapterCount: 16,
  isComplete: true,
  rating: 'Explicit',
  readStatus: 'Unread',
  isFavorite: true,
  pinned: false,
  availability: 'live',
  source: 'ao3',
  sourceUrl: 'https://archiveofourown.org/works/45992100',
  language: 'English',
  dateAdded: '3 Jun 2026',
  dateRead: null,
  summary:
    'Searching for death in all the wrong places, bounty hunter Han Jisung gets the opportunity of a lifetime… the chance to repay his debts and help his closest friend at the same time. The cost? Only his freedom… and possibly his life. But that’s okay, he never asked for it anyway.\n\n' +
    'Will Jisung find his end? Or is the vampire he sells himself to the beginning he hadn’t known he was searching for?\n\n' +
    '**\n\n' +
    'Fighting sleep, Jisung’s words come out slurred. “I’d love to be able to talk to animals. I’d have so many friends.”\n\n' +
    '“Friends?” Minho questions. “Not pets?”\n\n' +
    '“I can’t have pets…” He replies while snuggling deeper into his pillow. “… I’m a slave. I’m already the pet.”\n\n' +
    '————\n\n' +
    'Minho’s caged bird sings the most beautiful songs, and he wants nothing more than to free it. To dismantle the golden bars that keep Han’s heart cast in shadows and watch him bloom in freedom. The most stunning of creatures, it is a crime to chain him. A spirit like Han’s deserves to be free.\n\n' +
    'Or– Bounty hunter Han Jisung is sold to vampire Lee Minho to complete a job. One is broken, the other lost… but together, they could be complete.\n\n' +
    'Please don’t let the length of the fic scare you away…',
  tags: [
    // Content (AO3 archive warning folds in here, §6.3)
    t('Creator Chose Not To Use Archive Warnings', 'Content'),
    // Relationships
    tg('Han Jisung | Han/Lee Minho | Lee Know', 'Relationship', 6),
    t('Hwang Hyunjin/Lee Felix/Seo Changbin', 'Relationship'),
    t('Bang Chan/???', 'Relationship'),
    t('Kim Seungmin/Yang Jeongin | I.N.', 'Relationship'),
    // Characters
    t('Han Jisung | Han', 'Character'),
    t('Lee Minho | Lee Know', 'Character'),
    t('Bang Chan (Stray Kids)', 'Character'),
    t('Lee Felix (Stray Kids)', 'Character'),
    t('Seo Changbin', 'Character'),
    t('Hwang Hyunjin', 'Character'),
    t('Kim Seungmin (Stray Kids)', 'Character'),
    t('Yang Jeongin | I.N.', 'Character'),
    // Fandoms
    t('Stray Kids (Band)', 'Fandom'),
    t('Bangtan Boys | BTS Ensemble', 'Fandom'),
    t('ATEEZ Ensemble', 'Fandom'),
    // Universe
    tg('Alternate Universe - Vampire', 'Universe', 4),
    t('Alternate Universe - Fantasy', 'Universe'),
    t('Vampires', 'Universe'),
    t('Shifters', 'Universe'),
    t('Demons', 'Universe'),
    t('Paranormal', 'Universe'),
    // Identity — what each character IS in this AU
    t('Vampire Lee Minho | Lee Know', 'Identity'),
    t('Human Han Jisung | Han', 'Identity'),
    t('Demon Bang Chan (Stray Kids)', 'Identity'),
    t('Vampire Seo Changbin', 'Identity'),
    t('Human Lee Felix (Stray Kids)', 'Identity'),
    t('Human Hwang Hyunjin', 'Identity'),
    t('Human Yang Jeongin | I.N.', 'Identity'),
    t('Vampire Kim Seungmin (Stray Kids)', 'Identity'),
    // Mood
    t('Angst with a Happy Ending', 'Mood'),
    t('Fluff and Angst', 'Mood'),
    t('Mild Hurt/Comfort', 'Mood'),
    t('Dark Thoughts', 'Mood'),
    t('Depressing Thoughts', 'Mood'),
    t('Happy Ending', 'Mood'),
    t('lots of happy times', 'Mood'),
    // Content
    t('Explicit Sexual Content', 'Content'),
    t('Explicit Language', 'Content'),
    t('Master/Slave', 'Content'),
    t('Blood and Injury', 'Content'),
    t('Blood and Violence', 'Content'),
    t('very very mild blood kink', 'Content'),
    t('Fascination/Obsession with death', 'Content'),
    // Trope
    t('Bounty Hunters', 'Trope'),
  ],
}

/* ---- The Browse result set ------------------------------------------------ */
export const WORKS: Work[] = [
  bornToBurn,
  denseWork1,
  {
    workId: 41163886,
    title: 'Even in Arcadia',
    authors: ['quietmoon'],
    primaryShip: 'Bucky/Clint',
    primaryCollection: 'MCU',
    wordcount: 84120,
    rating: 'Mature',
    readStatus: 'Unread',
    isFavorite: true,
    pinned: true,
    availability: 'live',
    dateAdded: '20 Apr 2026',
    dateRead: null,
    summary:
      'After the snap, Clint retreats to a farmhouse that is not his own. Bucky shows up six weeks later with a duffel bag and no explanation, and neither of them is good at leaving.',
    tags: [
      t('Marvel Cinematic Universe', 'Fandom'),
      t('James "Bucky" Barnes/Clint Barton', 'Relationship'),
      t('Slow Burn', 'Structure'),
      t('Hurt/Comfort', 'Mood'),
      t('Found Family', 'Trope'),
      t('Post-Endgame', 'Universe'),
      t('Touch-Starved', 'Dynamics'),
    ],
  },
  denseWork2,
  {
    ...sibSelf,
    series: {
      name: 'The Arcadia Cycle',
      index: 2,
      total: 3,
      siblings: [sibA, sibSelf, sibC],
      matchIds: [sibSelf.workId, sibC.workId],
    },
  },
  {
    workId: 37551290,
    title: 'Salt and the Sea',
    authors: ['harbourlight'],
    primaryShip: null,
    primaryCollection: 'The Locked Tomb',
    wordcount: 12880,
    rating: 'Teen',
    readStatus: 'Unread',
    isFavorite: false,
    pinned: false,
    availability: 'live',
    dateAdded: '1 Jun 2026',
    dateRead: null,
    summary: 'Gideon learns to sail. It goes about as well as everything else Gideon does.',
    tags: [
      t('The Locked Tomb Series', 'Fandom'),
      t('Gen', 'Other'),
      t('Fluff', 'Mood'),
      t('Character Study', 'Structure'),
    ],
  },
  {
    workId: 28104500,
    title: 'A Hundred Quiet Rooms',
    authors: ['nettleblack'],
    primaryShip: 'Poly (Bucky/Steve/Sam)',
    primaryCollection: 'MCU',
    wordcount: 156300,
    rating: 'Explicit',
    readStatus: 'DNF',
    isFavorite: false,
    pinned: false,
    availability: 'locked',
    source: 'ao3',
    sourceUrl: 'https://archiveofourown.org/works/28104500',
    language: 'English',
    dateAdded: '2 Jan 2026',
    dateRead: '9 Feb 2026',
    summary: 'Three people, one apartment, and a lease none of them quite remember signing.',
    tags: [
      t('Marvel Cinematic Universe', 'Fandom'),
      t('Bucky Barnes/Steve Rogers/Sam Wilson', 'Relationship'),
      t('Polyamory', 'Dynamics'),
      t('Domestic', 'Mood'),
      t('Modern AU', 'Universe'),
    ],
  },
]

/* ---- Tag option sets for CategoryBox demos -------------------------------- */
/* `favorite` = always shown in the box (Tag Management state=favorite). Others
   appear only when found via search (session-only). `count` = library frequency.
   NB: a tag's "favorite" is distinct from a WORK's offline "pin". */
export type TagOption = { name: string; count: number; favorite?: boolean }

export const RELATIONSHIP_TAGS: TagOption[] = [
  { name: 'Steve Rogers/Tony Stark', count: 1840, favorite: true },
  { name: 'James "Bucky" Barnes/Steve Rogers', count: 1620, favorite: true },
  { name: 'James "Bucky" Barnes/Clint Barton', count: 410, favorite: true },
  { name: 'Geralt of Rivia/Jaskier', count: 980, favorite: true },
  { name: 'Castiel/Dean Winchester', count: 2210 },
  { name: 'Sherlock Holmes/John Watson', count: 1730 },
  { name: 'Draco Malfoy/Harry Potter', count: 3050 },
  { name: 'Aziraphale/Crowley', count: 1290 },
  { name: 'Wei Wuxian/Lan Wangji', count: 2640 },
  { name: 'Kirk/Spock', count: 870 },
  { name: 'Sam Wilson/Bucky Barnes', count: 540 },
  { name: 'Natasha Romanov/Steve Rogers', count: 320 },
  { name: 'Loki/Thor', count: 610 },
  { name: 'Peter Parker/Wade Wilson', count: 760 },
  { name: 'Hannibal Lecter/Will Graham', count: 1180 },
  { name: 'Eddie Diaz/Evan "Buck" Buckley', count: 1410 },
  { name: 'Nick/Charlie (Heartstopper)', count: 690 },
  { name: 'Bucky Barnes/Steve Rogers/Sam Wilson', count: 230 },
]

export const MOOD_TAGS: TagOption[] = [
  { name: 'Fluff', count: 3120, favorite: true },
  { name: 'Angst', count: 4210, favorite: true },
  { name: 'Hurt/Comfort', count: 2890, favorite: true },
  { name: 'Comfort', count: 880 },
  { name: 'Bittersweet', count: 540 },
  { name: 'Pining', count: 1620 },
  { name: 'Catharsis', count: 210 },
  { name: 'Cozy', count: 330 },
  { name: 'Dread', count: 190 },
  { name: 'Melancholy', count: 270 },
]

export const FANDOM_TAGS: TagOption[] = [
  { name: 'Marvel Cinematic Universe', count: 2140, favorite: true },
  { name: 'The Witcher (TV)', count: 760, favorite: true },
  { name: 'Stray Kids (Band)', count: 540 },
  { name: 'The Locked Tomb Series', count: 180 },
  { name: 'Harry Potter - J. K. Rowling', count: 1320 },
  { name: 'Good Omens (TV)', count: 690 },
  { name: 'Supernatural', count: 1510 },
  { name: 'Sherlock (TV)', count: 880 },
  { name: '9-1-1 (TV)', count: 720 },
  { name: 'Mo Dao Zu Shi - MXTX', count: 1140 },
  { name: 'Star Trek: Alternate Original Series', count: 430 },
]

export const CHARACTER_TAGS: TagOption[] = [
  { name: 'Bucky Barnes', count: 1610, favorite: true },
  { name: 'Steve Rogers', count: 1550, favorite: true },
  { name: 'Tony Stark', count: 1480 },
  { name: 'Clint Barton', count: 420 },
  { name: 'Sam Wilson', count: 510 },
  { name: 'Geralt of Rivia', count: 760 },
  { name: 'Jaskier | Dandelion', count: 740 },
  { name: 'Han Jisung | Han', count: 360 },
  { name: 'Lee Minho | Lee Know', count: 350 },
  { name: 'Castiel', count: 1290 },
  { name: 'Dean Winchester', count: 1310 },
]

export const IDENTITY_TAGS: TagOption[] = [
  { name: 'BAMF Bucky Barnes', count: 280, favorite: true },
  { name: 'Trans Steve Rogers', count: 140 },
  { name: 'Vampire Lee Minho | Lee Know', count: 60 },
  { name: 'Human Han Jisung | Han', count: 55 },
  { name: 'Werewolf Derek Hale', count: 410 },
  { name: 'Alpha Steve Rogers', count: 320 },
  { name: 'Omega Bucky Barnes', count: 350 },
  { name: 'Deaf Clint Barton', count: 190 },
  { name: 'Demon Bang Chan (Stray Kids)', count: 45 },
  { name: 'Autistic Peter Parker', count: 230 },
]

export const UNIVERSE_TAGS: TagOption[] = [
  { name: 'Alternate Universe - Modern Setting', count: 1820, favorite: true },
  { name: 'Canon Compliant', count: 940, favorite: true },
  { name: 'Alternate Universe - Coffee Shops & Cafés', count: 360 },
  { name: 'Alternate Universe - College/University', count: 680 },
  { name: 'Canon Divergence', count: 1130 },
  { name: 'Alternate Universe - Vampire', count: 240 },
  { name: 'Alternate Universe - Soulmates', count: 590 },
  { name: 'Crossover', count: 210 },
  { name: 'Fantasy', count: 470 },
]

export const CONTENT_TAGS: TagOption[] = [
  { name: 'Explicit Sexual Content', count: 2310, favorite: true },
  { name: 'Graphic Depictions Of Violence', count: 980 },
  { name: 'Major Character Death', count: 540 },
  { name: 'Hurt No Comfort', count: 420 },
  { name: 'No Archive Warnings Apply', count: 3100 },
  { name: 'Blood and Injury', count: 610 },
  { name: 'Recreational Drug Use', count: 230 },
]

export const TROPE_TAGS: TagOption[] = [
  { name: 'Found Family', count: 1980, favorite: true },
  { name: 'Enemies to Lovers', count: 1640, favorite: true },
  { name: 'Fake/Pretend Relationship', count: 1120 },
  { name: 'Friends to Lovers', count: 1340 },
  { name: 'Only One Bed', count: 760 },
  { name: 'Soulmates', count: 540 },
  { name: 'Time Travel', count: 480 },
  { name: 'Bounty Hunters', count: 90 },
]

export const STRUCTURE_TAGS: TagOption[] = [
  { name: 'Slow Burn', count: 2880, favorite: true },
  { name: 'One Shot', count: 1920 },
  { name: 'Epistolary', count: 210 },
  { name: 'Five Plus One', count: 640 },
  { name: 'Character Study', count: 520 },
  { name: 'Episodic', count: 180 },
]

/* Tag categories rendered as Browse filter boxes, in canonical order. Only
   non-empty categories appear (browse.md §7.3.2). */
export const TAG_CATEGORIES: { category: Category; tags: TagOption[] }[] = [
  { category: 'Fandom', tags: FANDOM_TAGS },
  { category: 'Relationship', tags: RELATIONSHIP_TAGS },
  { category: 'Character', tags: CHARACTER_TAGS },
  { category: 'Identity', tags: IDENTITY_TAGS },
  { category: 'Universe', tags: UNIVERSE_TAGS },
  { category: 'Content', tags: CONTENT_TAGS },
  { category: 'Trope', tags: TROPE_TAGS },
  { category: 'Mood', tags: MOOD_TAGS },
  { category: 'Structure', tags: STRUCTURE_TAGS },
]

export const RATINGS: Rating[] = ['General', 'Teen', 'Mature', 'Explicit', 'Not Rated']

export const READING_LISTS = ['Favorites', 'Priority', 'Travel reading', 'Comfort reads', 'To beta']

/* ---- Reading Lists (redesign §6.4 / docs/ux/reading-lists.md) ------------- */
/* Hand-curated, explicit-membership story lists. `memberIds` order = the
   `position` field (manual reorder). Two specials per the locked decisions:
   FAVORITES is the one system smart list (rule: is_favorite=true → membership is
   derived, not editable, no reorder); PRIORITY is an ORDINARY list that just
   ships auto-starred. Covers are 200×200 uploads in the real app — here they're
   stylized color blocks (the documented empty-list fallback) since the prototype
   has no images. */
export type ReadingList = {
  id: number
  name: string
  description?: string
  color: string            // drives the stylized cover block + list accent
  coverUrl?: string        // uploaded 200×200 cover (center-cropped square)
  autoPin: boolean         // per-list offline pin (downloads every member's epub)
  isSystem?: boolean       // Favorites only: rule-based, non-deletable, no reorder
  starred?: boolean        // auto-starred (Priority); surfaced as a Browse quick chip
  memberIds: number[]      // ordered work ids; for the system list this is rule-derived
}

export const READING_LISTS_DATA: ReadingList[] = [
  {
    id: 1, name: 'Favorites', color: '#f59e0b', autoPin: false, isSystem: true, starred: true,
    description: 'AO3 Bookmarks',
    // rule-derived: all works with isFavorite=true, most-recently-favorited first
    memberIds: [45992100, 41163886, 39882011, 44120999],
  },
  {
    id: 2, name: 'Priority', color: '#6366f1', autoPin: true, starred: true,
    description: 'Read next.',
    memberIds: [44120999, 43771204, 37551290],
  },
  {
    id: 3, name: 'Travel reading', color: '#0ea5a4', autoPin: true,
    description: 'Pinned offline for the flight.',
    memberIds: [45992100, 28104500, 39882011, 41163886, 43771204],
  },
  {
    id: 4, name: 'Comfort reads', color: '#db2777', autoPin: false,
    description: 'Reread when the world is too much.',
    memberIds: [41163886, 39882011],
  },
  {
    id: 5, name: 'To beta', color: '#7c3aed', autoPin: false,
    memberIds: [],
  },
]

/* Canonical reading-list order: the system Favorites list first, then other
   STARRED lists alphabetically, then the rest in their existing order. Used for
   the index grid AND the Browse quick-chip row so the two always agree. */
export const sortReadingLists = (lists: ReadingList[]): ReadingList[] => {
  const rank = (l: ReadingList) => (l.isSystem ? 0 : l.starred ? 1 : 2)
  return [...lists].sort((a, b) => {
    const r = rank(a) - rank(b)
    if (r !== 0) return r
    return rank(a) === 2 ? 0 : a.name.localeCompare(b.name) // unstarred: keep order
  })
}

/* The starred subset, in the canonical order — these become the Browse chips. */
export const starredReadingLists = (lists: ReadingList[]): ReadingList[] =>
  sortReadingLists(lists).filter((l) => l.isSystem || l.starred)

/* ---- Sync view (redesign §12.4–12.5; reconciles the Calibre-era sync-view.md) */
/* The worker is a THIN local agent: only X4 SD-card transfer + local backup pull
   (pc_jobs). Snapshot rebuild + R2 re-upload are SERVER (Railway) operations, not
   worker jobs, so they're not gated by the worker heartbeat. No FanFicFare update
   check (removed — hard rule). */
export type WorkerStatus = 'online' | 'stale' | 'offline'
export type PcJobType = 'x4_transfer' | 'backup_pull'
export type JobStatus = 'pending' | 'running' | 'done' | 'failed'

export type SyncTrigger = {
  id: string
  label: string
  scope: 'worker' | 'server'   // worker triggers gate on the heartbeat
  jobType?: PcJobType
  lastRun: string | null
  lastStatus: JobStatus | null
}

export const SYNC_TRIGGERS: SyncTrigger[] = [
  { id: 'x4', label: 'Sync X4', scope: 'worker', jobType: 'x4_transfer', lastRun: '2h ago', lastStatus: 'done' },
  { id: 'backup', label: 'Backup pull', scope: 'worker', jobType: 'backup_pull', lastRun: 'yesterday', lastStatus: 'done' },
  { id: 'snapshot', label: 'Refresh snapshot', scope: 'server', lastRun: '5m ago', lastStatus: 'done' },
  { id: 'r2', label: 'Re-upload to R2', scope: 'server', lastRun: '3 days ago', lastStatus: 'done' },
]

export type PcJob = { id: string; type: PcJobType; status: JobStatus; detail: string; time: string }
export const PC_JOBS: PcJob[] = [
  { id: 'j-1', type: 'x4_transfer', status: 'running', detail: 'Copying 1,284 works to SD card', time: 'now' },
  { id: 'j-2', type: 'backup_pull', status: 'pending', detail: 'Queued behind X4 transfer', time: '1m ago' },
  { id: 'j-3', type: 'x4_transfer', status: 'failed', detail: 'SD card not mounted', time: '2h ago' },
]

export type ActivityKind = 'capture' | 'status' | 'snapshot' | 'transfer' | 'backup' | 'error'
export type ActivityEvent = { id: number; kind: ActivityKind; message: string; time: string }
export const ACTIVITY_EVENTS: ActivityEvent[] = [
  { id: 1, kind: 'transfer', message: 'X4 transfer started — 1,284 works', time: 'just now' },
  { id: 2, kind: 'snapshot', message: 'Snapshot rebuilt → v412', time: '5m ago' },
  { id: 3, kind: 'capture', message: 'Captured “Both Sides of the Shield” → Review Queue', time: '2h ago' },
  { id: 4, kind: 'error', message: 'X4 transfer failed — SD card not mounted', time: '2h ago' },
  { id: 5, kind: 'status', message: 'Marked “No Gods, Only Highways” as Read', time: '4h ago' },
  { id: 6, kind: 'capture', message: 'Committed “Born to Burn” + epub → R2', time: 'yesterday' },
  { id: 7, kind: 'backup', message: 'Backup pull complete — 38 MB', time: 'yesterday' },
  { id: 8, kind: 'snapshot', message: 'Snapshot rebuilt → v411', time: 'yesterday' },
]

export const SNAPSHOT_VERSION = 412
export const WORKER_HEARTBEAT_AGE = '12s ago'

/* ---- Extension injected controls (on-AO3 mock; redesign §12.1–12.2) ------- */
/* The extension hooks AO3's native buttons (Mark for Later → capture, Mark as
   Read → Read, Bookmark → Favorite) and injects only DNF + a status badge + the
   pending-actions banner. Status set: Unread | Read | DNF, with Favorite (★)
   orthogonal; N/A = not in the library at all (distinct from Unread). Bookmarks
   StoryHub makes are always private. No Priority badge (it's a reading list now);
   no FanFicFare. */
export type LibraryState =
  | { inLibrary: false }
  | { inLibrary: true; status: ReadStatus; favorite: boolean }

export type Ao3ActionKind = 'mark_read' | 'bookmark' | 'remove_bookmark'
export type Ao3Action = { id: number; label: string; kind: Ao3ActionKind }
/* App-initiated side-effects waiting to be flushed on the next AO3 page load. */
export const PENDING_AO3_ACTIONS: Ao3Action[] = [
  { id: 1, kind: 'mark_read', label: 'Mark “No Gods, Only Highways” as read' },
  { id: 2, kind: 'bookmark', label: 'Bookmark “Born to Burn” (private)' },
  { id: 3, kind: 'remove_bookmark', label: 'Remove bookmark from “A Hundred Quiet Rooms”' },
]

/* The work page the injected control cluster mounts on (a fresh capture). Shaped
   like an AO3 work blurb so the mock host page reads as real AO3. */
export const EXT_WORK = {
  workId: 99000042,
  title: 'The Cartographer’s Apology',
  authors: ['inkandiron'],
  rating: 'Mature' as Rating,
  warnings: ['No Archive Warnings Apply'],
  categories: ['M/M'],
  fandoms: ['The Witcher (TV)'],
  relationships: ['Geralt of Rivia/Jaskier | Dandelion'],
  characters: ['Geralt of Rivia', 'Jaskier | Dandelion', 'Yennefer of Vengerberg'],
  additionalTags: ['Slow Burn', 'Hurt/Comfort', 'Road Trips', 'Pining', 'Mutual Pining', 'Eventual Smut', 'Idiots in Love'],
  language: 'English',
  series: 'Part 2 of The Long Way Round',
  published: '2026-06-10',
  words: 84120,
  chapters: '6/12',
  comments: 214,
  kudos: 1893,
  bookmarks: 142,
  hits: 28104,
  summary:
    'Geralt has crossed the Continent twice over and drawn a map of every mile, but there is one road he keeps leaving off the page. When a contract strands him and Jaskier in a town that doesn’t exist on any chart, the bard starts asking the kind of questions a cartographer spends his whole life avoiding.',
}

export type ListingRow = {
  workId: number
  title: string
  author: string
  fandom: string
  tags: string[]
  summary: string
  words: number
  state: LibraryState
}
export const LISTING_ROWS: ListingRow[] = [
  {
    workId: 44120999, title: 'The Weight of Quiet Mornings', author: 'saltandsteel',
    fandom: 'Marvel Cinematic Universe', tags: ['Bucky Barnes/Steve Rogers', 'Slow Burn', 'Hurt/Comfort', 'Recovery'],
    summary: 'Seventy years out of the ice, Bucky has gotten very good at three things, and wanting Steve is not one of them.',
    words: 487300, state: { inLibrary: true, status: 'Unread', favorite: true },
  },
  {
    workId: 43771204, title: 'No Gods, Only Highways', author: 'emberlight, thrushsong',
    fandom: 'The Witcher (TV)', tags: ['Geralt/Jaskier', 'Modern AU', 'Road Trips', 'Found Family'],
    summary: 'A tow truck, a dead phone, and a thousand small choices that look, in the rear-view, a lot like falling in love.',
    words: 162540, state: { inLibrary: true, status: 'Read', favorite: false },
  },
  {
    workId: 99000001, title: 'A Stranger’s Map of Home', author: 'driftwoodking',
    fandom: 'The Witcher (TV)', tags: ['Geralt/Jaskier', 'Hurt/Comfort', 'Canon Divergence'],
    summary: 'Jaskier draws maps of places he has never been. One of them, impossibly, leads Geralt home.',
    words: 53200, state: { inLibrary: false },
  },
  {
    workId: 28104500, title: 'A Hundred Quiet Rooms', author: 'nettleblack',
    fandom: 'Marvel Cinematic Universe', tags: ['Bucky/Steve/Sam', 'Polyamory', 'Domestic', 'Modern AU'],
    summary: 'Three people, one apartment, and a lease none of them quite remember signing.',
    words: 156300, state: { inLibrary: true, status: 'DNF', favorite: false },
  },
]

/* ---- Saved Filters (redesign §12.6 / docs/ux/saved-filters.md) ------------ */
/* Named presets of Browse filter + sort state, re-evaluated live. Stored tokens
   reference the resolved GROUP where one exists, else the raw tag. On load any
   token that no longer resolves (e.g. a raw tag that since joined a group) is
   re-validated and VISIBLY FLAGGED (`stale`), never silently dropped. Starred
   filters pin to the top and appear as one-tap Browse chips. */
export type FilterTermKind =
  | 'include' | 'exclude' | 'status' | 'words' | 'rating' | 'date' | 'author' | 'list'
export type FilterTerm = {
  label: string
  kind: FilterTermKind
  stale?: boolean          // term no longer resolves → re-validate banner + flag
  resolvesTo?: string      // the group/canonical it now resolves to (shown on re-validate)
}
export type SavedFilter = {
  id: number
  name: string
  starred: boolean
  terms: FilterTerm[]
  sort: string             // matches a SORT_OPTIONS short label
}

export const SAVED_FILTERS: SavedFilter[] = [
  {
    id: 1, name: 'Marvel comfort', starred: true, sort: 'Added ↓',
    terms: [
      { label: 'MCU', kind: 'include' },
      { label: 'Hurt/Comfort', kind: 'include' },
      { label: 'Major Character Death', kind: 'exclude' },
      { label: 'Unread', kind: 'status' },
    ],
  },
  {
    id: 2, name: 'Long slow burns', starred: true, sort: 'Words ↓',
    terms: [
      { label: 'Slow Burn', kind: 'include' },
      { label: '80k+', kind: 'words' },
      { label: 'Teen → Explicit', kind: 'rating' },
    ],
  },
  {
    id: 3, name: 'Witcher road trips', starred: true, sort: 'Added ↓',
    terms: [
      { label: 'The Witcher', kind: 'include' },
      { label: 'Road Trips', kind: 'include' },
      { label: 'Modern AU', kind: 'include' },
    ],
  },
  {
    id: 4, name: 'Wangxian to reread', starred: false, sort: 'Read ↓',
    terms: [
      { label: 'Wangxian', kind: 'include' },
      { label: 'Read', kind: 'status' },
      { label: 'in Comfort reads', kind: 'list' },
    ],
  },
  {
    id: 5, name: 'Stucky novels', starred: false, sort: 'Words ↓',
    terms: [
      // a raw tag that has since folded into the "Stucky" canonical group →
      // re-validated on load and flagged (§12.6, no silent drop)
      { label: 'James "Bucky" Barnes/Steve Rogers', kind: 'include', stale: true, resolvesTo: 'Stucky' },
      { label: '80k+', kind: 'words' },
      { label: 'saltandsteel', kind: 'author' },
    ],
  },
]

export const AUTHORS = [
  'saltandsteel', 'quietmoon', 'emberlight', 'thrushsong', 'ironwrites',
  'saltflats', 'harbourlight', 'nettleblack', 'Yoonmincraze',
]

export const WORDCOUNT_BUCKETS = ['<10k', '10–30k', '30–80k', '80k+'] as const

export const SORT_OPTIONS: { label: string; short: string }[] = [
  { label: 'Date added — newest', short: 'Added ↓' },
  { label: 'Date added — oldest', short: 'Added ↑' },
  { label: 'Date read — newest', short: 'Read ↓' },
  { label: 'Word count — high to low', short: 'Words ↓' },
  { label: 'Word count — low to high', short: 'Words ↑' },
  { label: 'Title — A to Z', short: 'Title' },
  { label: 'Author — A to Z', short: 'Author' },
  { label: 'Surprise me', short: 'Random' },
]

/* A longer result set so the Browse list scrolls (real list virtualizes at
   Phase F — ~7k works). Repeats the base works with offset ids. */
export const BROWSE_RESULTS: Work[] = [0, 1, 2].flatMap((pass) =>
  WORKS.map((w) => (pass === 0 ? w : { ...w, workId: w.workId + pass * 1_000_000, series: undefined })),
)

export const NAV_ITEMS = [
  { id: 'browse', label: 'Browse', icon: '🔍' },
  { id: 'filters', label: 'Saved Filters', icon: '⭐' },
  { id: 'lists', label: 'Reading Lists', icon: '📚' },
  { id: 'review', label: 'Review Queue', icon: '📥', badge: 3 },
  { id: 'pending', label: 'Pending', icon: '⏳' },
  { id: 'tags', label: 'Tags', icon: '🏷️' },
  { id: 'stats', label: 'Stats', icon: '📊' },
  { id: 'sync', label: 'Sync', icon: '🔄' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
] as const

export const fmtWords = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)

/* ---- Tag Management (redesign §12.6 / §6.3 / §6.3.1) --------------------- */
/* The single home for all tag curation: a filterable surface (never a queue).
   Every tag carries kind, category (freeform/warning only — NULL for structural
   kinds and for uncategorized), state, group memberships, auto_classified, and
   library frequency. Grouping/synonym/canonical work lives ONLY here. */

export type TagKind = 'fandom' | 'relationship' | 'character' | 'freeform' | 'warning'
export type TagState = 'favorite' | 'normal' | 'excluded'
/* Roll-up groups have a CLASS inferred from member kind (§6.3.1 refinement):
   fandom → collection (structural); anything else → property (filter bundle). */
export type GroupClass = 'collection' | 'property'
export type TagGroupRef = { name: string; cls: GroupClass }

export type ManagedTag = {
  id: number
  name: string
  kind: TagKind
  category: Category | null
  state: TagState
  autoClassified: boolean
  count: number
  displayName?: string          // display alias (layer 2) — shown in place of name
  canonical?: boolean           // canonical owner of a synonym set (layer 1)
  synonymOf?: string            // name of the canonical this collapses into
  groups: TagGroupRef[]         // roll-up memberships (layer 3)
}

/* Freeform-assignable categories (the `categories` table — §12.6). Structural
   kinds (fandom/relationship/character) take no category; Rating is a column. */
export const FREEFORM_CATEGORIES: Category[] = [
  'Identity', 'Universe', 'Content', 'Trope', 'Dynamics', 'Mood', 'Structure', 'Other',
]

/* Structural kinds (fandom + relationship — both feed XTEINK folder levels) →
   collection; descriptive kinds (character/freeform/warning) → property. */
export const groupClassOf = (k: TagKind): GroupClass =>
  (k === 'fandom' || k === 'relationship' ? 'collection' : 'property')

/* Synonym "domain": two tags may be synonyms only within the same domain —
   the category if it has one, else the kind (§6.3.1 refinement). */
export const synonymDomainOf = (t: { category: Category | null; kind: TagKind }): string =>
  t.category ?? `kind:${t.kind}`

/* Existing roll-up groups for the "add to group" picker. */
export const TAG_GROUPS: TagGroupRef[] = [
  { name: 'MCU', cls: 'collection' },
  { name: 'The Witcher', cls: 'collection' },
  { name: 'Robin/Barbara Gordon', cls: 'collection' },
  { name: 'Poly', cls: 'property' },
  { name: 'Graphic Violence', cls: 'property' },
]

const cg = (name: string): TagGroupRef => ({ name, cls: 'collection' })
const pg = (name: string): TagGroupRef => ({ name, cls: 'property' })

export const MANAGED_TAGS: ManagedTag[] = [
  // Fandoms → collection roll-up groups
  { id: 1, name: 'Marvel Cinematic Universe', kind: 'fandom', category: null, state: 'favorite', autoClassified: false, count: 2140, groups: [cg('MCU')] },
  { id: 2, name: 'Avengers: Endgame (Movie)', kind: 'fandom', category: null, state: 'normal', autoClassified: false, count: 410, groups: [cg('MCU')] },
  { id: 3, name: 'The Falcon and the Winter Soldier (TV)', kind: 'fandom', category: null, state: 'normal', autoClassified: false, count: 120, groups: [cg('MCU')] },
  { id: 4, name: 'The Witcher (TV)', kind: 'fandom', category: null, state: 'favorite', autoClassified: false, count: 760, groups: [cg('The Witcher')] },
  { id: 5, name: '9-1-1 (TV)', kind: 'fandom', category: null, state: 'normal', autoClassified: false, count: 720, groups: [] }, // ungrouped

  // Relationships → canonical + synonyms + display alias (no group object needed)
  { id: 6, name: 'Bucky Barnes/Steve Rogers', kind: 'relationship', category: null, state: 'favorite', autoClassified: false, count: 1620, canonical: true, displayName: 'Stucky', groups: [] },
  { id: 7, name: 'James "Bucky" Barnes/Steve Rogers', kind: 'relationship', category: null, state: 'normal', autoClassified: false, count: 300, synonymOf: 'Bucky Barnes/Steve Rogers', groups: [] },
  { id: 8, name: 'Steve Rogers/Tony Stark', kind: 'relationship', category: null, state: 'favorite', autoClassified: false, count: 1840, canonical: true, displayName: 'Stony', groups: [] },
  { id: 9, name: 'Bucky Barnes/Sam Wilson', kind: 'relationship', category: null, state: 'normal', autoClassified: false, count: 540, canonical: true, displayName: 'SamBucky', groups: [] }, // canonical + alias; ungrouped
  { id: 10, name: 'Wei Wuxian/Lan Wangji', kind: 'relationship', category: null, state: 'favorite', autoClassified: false, count: 2640, canonical: true, displayName: 'Wangxian', groups: [] },

  // Characters
  { id: 11, name: 'Bucky Barnes', kind: 'character', category: null, state: 'favorite', autoClassified: false, count: 1610, groups: [] },
  { id: 12, name: 'Steve Rogers', kind: 'character', category: null, state: 'normal', autoClassified: false, count: 1550, groups: [] },

  // Freeform → category + canonical/synonyms + property groups
  { id: 13, name: 'Slow Burn', kind: 'freeform', category: 'Structure', state: 'favorite', autoClassified: false, count: 2880, canonical: true, groups: [] },
  { id: 14, name: 'slowburn', kind: 'freeform', category: 'Structure', state: 'normal', autoClassified: true, count: 90, synonymOf: 'Slow Burn', groups: [] },
  { id: 15, name: 'Hurt/Comfort', kind: 'freeform', category: 'Mood', state: 'favorite', autoClassified: false, count: 2890, groups: [] },
  { id: 16, name: 'Touch-Starved', kind: 'freeform', category: 'Dynamics', state: 'normal', autoClassified: false, count: 410, groups: [] },
  { id: 17, name: 'Threesome - M/M/M', kind: 'freeform', category: null, state: 'normal', autoClassified: false, count: 200, groups: [pg('Poly')] }, // uncategorized
  { id: 18, name: 'Polyamory', kind: 'freeform', category: 'Dynamics', state: 'normal', autoClassified: false, count: 380, canonical: true, groups: [pg('Poly')] },
  { id: 19, name: 'Domestic Fluff', kind: 'freeform', category: null, state: 'normal', autoClassified: false, count: 660, groups: [] }, // uncategorized
  { id: 20, name: 'BAMF Bucky Barnes', kind: 'freeform', category: 'Other', state: 'normal', autoClassified: true, count: 280, groups: [] },
  { id: 21, name: 'Author Is Sleep Deprived', kind: 'freeform', category: 'Other', state: 'excluded', autoClassified: true, count: 40, groups: [] },
  { id: 22, name: 'Vampire Lee Minho | Lee Know', kind: 'freeform', category: 'Identity', state: 'normal', autoClassified: true, count: 60, groups: [] },

  // Mixed-kind property group "Graphic Violence": a warning + a freeform together
  { id: 23, name: 'Graphic Depictions Of Violence', kind: 'warning', category: 'Content', state: 'normal', autoClassified: false, count: 980, groups: [pg('Graphic Violence')] },
  { id: 24, name: 'Creator Chose Not To Use Archive Warnings', kind: 'warning', category: 'Content', state: 'normal', autoClassified: false, count: 1200, groups: [] },
  { id: 25, name: 'Blood and Injury', kind: 'freeform', category: 'Content', state: 'normal', autoClassified: false, count: 610, groups: [pg('Graphic Violence')] },
]

/* ---- Review Queue (redesign §12.1, corrected to §6.3.1 / §9 / §12.6) ------ */
/* The Review Queue sets ONLY the per-work primary-role FLAGS
   (work_tags.is_primary_ship / is_primary_collection) — it picks WHICH of the
   work's own raw tags is primary, defaulting to the AO3 first-listed one. It does
   NOT assign or create groups: grouping/synonyms are entirely Tag Management
   (§12.6, "the Review Queue never touches tags"). A work only lands here when an
   axis is AMBIGUOUS (>1 fandom or >1 relationship); single/single and gen works
   auto-commit with the obvious default. The card later DISPLAYS the flagged tag
   via its group/synonym (e.g. flagged "Bucky Barnes/Sam Wilson" → "Winterhawk"). */

/* Existing groups Tag Management curates (used by the Tags surface, not here). */
export const SHIP_GROUPS = [
  'Steve/Tony', 'Bucky/Steve', 'Bucky/Clint', 'Geralt/Jaskier',
  'Han/Lee Minho', 'Buck/Eddie', 'Castiel/Dean', 'Wangxian',
]
export const COLLECTION_GROUPS = [
  'MCU', 'The Witcher', 'Stray Kids', 'The Locked Tomb', 'Good Omens', 'Supernatural', '9-1-1',
]

export type ReviewItem = {
  queueId: string
  workId: number
  title: string
  authors: string[]
  rating: Rating
  wordcount: number
  capturedAt: string
  fandoms: string[]         // raw AO3 tags, AO3 order; primary defaults to [0]
  relationships: string[]   // raw AO3 tags, AO3 order; [] = gen (no ship)
}

export const REVIEW_ITEMS: ReviewItem[] = [
  {
    // Both axes ambiguous (the worked example: 2 fandoms, 2 ships).
    queueId: 'q-1', workId: 46512233, title: 'Both Sides of the Shield',
    authors: ['paperkite'], rating: 'Mature', wordcount: 118400, capturedAt: '2 hours ago',
    fandoms: ['Avengers: Endgame (Movie)', 'The Falcon and the Winter Soldier (TV)'],
    relationships: ['Bucky Barnes/Sam Wilson', 'Bucky Barnes/Steve Rogers'],
  },
  {
    // Ship ambiguous only (one fandom → collection auto, two ships → choose).
    queueId: 'q-2', workId: 46498120, title: 'The Long Road from Cintra',
    authors: ['emberlight'], rating: 'Explicit', wordcount: 64200, capturedAt: 'yesterday',
    fandoms: ['The Witcher (TV)'],
    relationships: ['Geralt of Rivia/Jaskier', 'Geralt of Rivia/Yennefer of Vengerberg'],
  },
  {
    // Fandom ambiguous only + gen (crossover with no relationship tag).
    queueId: 'q-3', workId: 46470088, title: 'Necromancers of Arrakis',
    authors: ['cloudrecesses'], rating: 'Teen', wordcount: 203900, capturedAt: 'yesterday',
    fandoms: ['The Locked Tomb Series - Tamsyn Muir', 'Dune - Frank Herbert'],
    relationships: [],
  },
]

/* ---- In-app reader fallback content (§5) --------------------------------- */
/* The reader is the universal fallback when OS hand-off is awkward. In the real
   app it renders the stored epub's XHTML; here it's mock prose so the typography,
   chapter nav, and reading controls can be designed. */
export type ReaderChapter = { title: string; paras: string[] }

export const READER_SAMPLE: ReaderChapter[] = [
  {
    title: 'Chapter 1 — The Auction',
    paras: [
      'The cold came first, the way it always did — a thin blade of it slipping under the warehouse doors, finding the gaps in his coat, settling into the old break in his left wrist. Jisung had stopped minding the cold years ago. It was honest, at least. It wanted nothing from him but his attention, and that he could afford.',
      'The buyers were another matter. They lined the upper gallery in their good coats and their bad intentions, and not one of them looked at him like he was a person. That was fine too. He had not come here to be looked at like a person. He had come here to be sold, and to be paid for the selling, and to walk out the far door with his debts a little lighter and his pride exactly where it had always been: somewhere far behind him, lost on a road he no longer remembered taking.',
      'Then the man in the third seat leaned forward into the light, and something in Jisung’s chest — some small, stubborn, long-asleep thing — turned over and opened one eye.',
      '“That one,” the man said. His voice was quiet and certain, the voice of someone who had never once in his long life needed to raise it. “I’ll take that one.”',
    ],
  },
  {
    title: 'Chapter 2 — A Cage of Gold',
    paras: [
      'The house was the largest he had ever stood inside, and the quietest. No clatter of the markets, no shouting through thin walls, no city pressing its thousand elbows into his ribs. Only the hush of rooms that had been built to be vast, and the slow tick of a clock somewhere he could not find.',
      '“You may go anywhere,” Minho told him, on the first night, as if that were a kindness and not the cruelest joke of all. “The library, the gardens, the long hall. Anywhere but the eastern stair.”',
      '“And if I go to the eastern stair?” Jisung asked, because he had never in his life been told not to do a thing without immediately wanting to do it.',
      'Minho only smiled, and the smile had teeth in it, and for the first time Jisung remembered exactly what he had sold himself to.',
    ],
  },
  {
    title: 'Chapter 3 — Songs for No One',
    paras: [
      'He sang because the silence was worse. He sang in the empty library and the colder gardens, old songs and half-remembered ones and a few he made up on the spot, just to hear a human sound in all that marble.',
      'He did not know, at first, that he was being listened to. He found out the way one finds out about most of Minho’s habits: too late, and all at once.',
      '“Don’t stop,” said the voice from the doorway, when he stopped. “I’ve walked a great many years, little bird. I have heard a great many things.” A pause, and then, softer, almost against his will: “I have not heard anything like that.”',
    ],
  },
]
