// seed-users.mjs — populate the live backend with diverse sample users.
// Run: node scripts/seed-users.mjs [API_BASE]
// Default API_BASE = live Railway backend.

const API = process.argv[2] || 'https://spectrum-dating-server-production.up.railway.app';
const PASSWORD = 'SamplePass123!';

// Field limits (from profile route): displayName<=30, tagline<=80, bio<=500,
// commNote<=120, distCity<=100, interest<=30 chars, relationshipGoal in
// ['', 'long-term', 'friendship', 'open'], notificationTier in
// ['in_app','silent_push','name_only'].

const USERS = [
  {
    name: 'Quiet Cartographer', tagline: 'Mapping the world one quiet street at a time',
    bio: "I make hand-drawn maps of places I've walked. Low-key, detail-oriented, and happiest with a thermos of tea and a fine-liner pen. I love a person who can sit in comfortable silence.",
    interests: ['cartography', 'hiking', 'tea', 'drawing', 'history', 'walking'],
    comm: 'Async text is my comfort zone. I reply thoughtfully, not fast.',
    goal: 'long-term', city: 'Portland', tier: 'in_app',
  },
  {
    name: 'Mira K.', tagline: 'Botanist by day, stargazer by night',
    bio: 'I keep 40 houseplants alive and named. Weekends are for greenhouses and planetariums. I info-dump about photosynthesis when excited — fair warning, and also a feature.',
    interests: ['gardening', 'astronomy', 'botany', 'science', 'nature', 'reading'],
    comm: 'Direct questions please — hints get lost on me. I value clarity.',
    goal: 'long-term', city: 'Seattle', tier: 'in_app',
  },
  {
    name: 'Dev', tagline: 'Mechanical keyboards and slow mornings',
    bio: 'Software person who codes for calm, not hustle. I build tiny tools nobody asked for. Looking for someone to share spreadsheets of restaurants we want to try.',
    interests: ['coding', 'spreadsheets', 'cooking', 'gaming', 'films', 'cats'],
    comm: 'I prefer planned calls over surprise ones. Send an agenda, I love it.',
    goal: 'open', city: 'Austin', tier: 'silent_push',
  },
  {
    name: 'Rowan Ashby', tagline: 'Birdwatcher with a very long list',
    bio: 'Up at dawn for the warblers. I find people the same way I find birds — patiently, with binoculars and a lot of waiting. 312 species and counting. Want to come along?',
    interests: ['birdwatching', 'nature', 'photography', 'hiking', 'science', 'walking'],
    comm: 'Low-pressure pacing. No need to fill every silence on a walk.',
    goal: 'friendship', city: 'Portland', tier: 'in_app',
  },
  {
    name: 'Priya S.', tagline: 'Baker of breads with opinions',
    bio: 'Sourdough is a relationship and I am very committed. I read cookbooks like novels. Sensory-sensitive, so dim lights and quiet cafes win my heart every time.',
    interests: ['baking', 'cooking', 'reading', 'crafts', 'gardening', 'tea'],
    comm: 'Texts over calls. I need processing time before big conversations.',
    goal: 'long-term', city: 'Chicago', tier: 'name_only',
  },
  {
    name: 'Sam Halloran', tagline: 'Vinyl records and rainy afternoons',
    bio: 'I catalogue my record collection by mood. Jazz for focus, post-rock for walks. Happiest sharing headphones, one ear each, no talking required.',
    interests: ['music', 'films', 'reading', 'photography', 'history', 'walking'],
    comm: 'I communicate best in writing. Long messages welcome and returned.',
    goal: 'open', city: 'Seattle', tier: 'in_app',
  },
  {
    name: 'Toby', tagline: 'Trainspotter, proudly',
    bio: 'Yes, I know the timetable. Yes, I will tell you about the rolling stock. I am loyal, literal, and excellent at remembering the things you care about. Routine is romance to me.',
    interests: ['trains', 'history', 'photography', 'gaming', 'science', 'maps'],
    comm: 'Predictable plans help me thrive. Tell me what to expect, please.',
    goal: 'long-term', city: 'Boston', tier: 'silent_push',
  },
  {
    name: 'Nadia Okonkwo', tagline: 'Painter of very small things',
    bio: 'Miniatures and watercolour. I notice the detail everyone else walks past. I love deep one-on-one conversations and will happily skip the small talk entirely.',
    interests: ['art', 'crafts', 'reading', 'films', 'nature', 'cats'],
    comm: 'One-on-one over groups. Crowds drain me; a quiet corner refills me.',
    goal: 'long-term', city: 'Chicago', tier: 'in_app',
  },
  {
    name: 'Eli Brenner', tagline: 'Chess, puzzles, and good soup',
    bio: 'I think in systems and cook in batches. Competitive at board games but kind about it. Looking for a steady, low-drama companion to build small routines with.',
    interests: ['chess', 'board games', 'cooking', 'puzzles', 'reading', 'science'],
    comm: 'Say what you mean directly. I will never read between the lines well.',
    goal: 'long-term', city: 'Austin', tier: 'in_app',
  },
  {
    name: 'Wren', tagline: 'Knitter, podcast hoarder, cat staff',
    bio: 'I make sweaters faster than I can wear them. Two cats run my life. I stim with yarn and I am unbothered. Seeking gentle company and parallel play.',
    interests: ['knitting', 'crafts', 'cats', 'reading', 'music', 'baking'],
    comm: 'Parallel play is my love language. We can be alone together.',
    goal: 'friendship', city: 'Denver', tier: 'name_only',
  },
  {
    name: 'Hassan Reyes', tagline: 'Climbing routes and reading maps',
    bio: 'Bouldering keeps my body busy so my mind can rest. I plan trips in detail and love a shared itinerary. Direct, dependable, and quietly affectionate.',
    interests: ['climbing', 'hiking', 'maps', 'photography', 'cooking', 'nature'],
    comm: 'I like a heads-up before plans change. Spontaneity stresses me.',
    goal: 'open', city: 'Denver', tier: 'in_app',
  },
  {
    name: 'June Park', tagline: 'Library lurker, tea completist',
    bio: 'I have read in every quiet corner of three libraries. I collect loose-leaf tea and strong opinions about fonts. Looking for someone calm to share long, slow Sundays.',
    interests: ['reading', 'tea', 'libraries', 'writing', 'history', 'cats'],
    comm: 'Quiet evenings, low lighting, no pressure to perform. That is me.',
    goal: 'long-term', city: 'Seattle', tier: 'in_app',
  },
  {
    name: 'Marco', tagline: 'Cyclist, mapmaker, early sleeper',
    bio: 'I ride the same loop every morning and notice something new each time. Predictability is comfort, not boredom. I want a co-pilot, not a whirlwind.',
    interests: ['cycling', 'maps', 'photography', 'cooking', 'nature', 'science'],
    comm: 'Routines are how I show love. Same coffee shop, same time, happily.',
    goal: 'long-term', city: 'Portland', tier: 'silent_push',
  },
  {
    name: 'Ana Beltran', tagline: 'Documentaries and dried-flower pressing',
    bio: 'I press flowers from every place I go and label them obsessively. I love niche documentaries and will send you twelve. Soft-spoken, deeply loyal, a little shy at first.',
    interests: ['films', 'crafts', 'gardening', 'nature', 'photography', 'reading'],
    comm: 'Give me time to warm up. I am most myself after a few good chats.',
    goal: 'long-term', city: 'Chicago', tier: 'name_only',
  },
  {
    name: 'Felix Nordmann', tagline: 'Astrophysics memes and long walks',
    bio: 'I explain the universe at parties whether asked or not. Walking helps me think and talk at once. Seeking a curious mind who likes questions more than answers.',
    interests: ['astronomy', 'science', 'walking', 'gaming', 'music', 'reading'],
    comm: 'I info-dump when happy. Tell me if you need me to pause — I will.',
    goal: 'open', city: 'Boston', tier: 'in_app',
  },
  {
    name: 'Indira V.', tagline: 'Volunteer gardener, slow cook, big heart',
    bio: 'I grow vegetables for a community plot and feed everyone who visits. Routine-loving and nurturing. I want something steady, kind, and unhurried.',
    interests: ['gardening', 'cooking', 'volunteering', 'nature', 'baking', 'crafts'],
    comm: 'Plain words, kind tone. I do not do mind games or guessing.',
    goal: 'long-term', city: 'Austin', tier: 'in_app',
  },
  {
    name: 'Casper', tagline: 'Retro games and quiet company',
    bio: 'I speedrun old platformers and collect cartridges. Happiest gaming side by side with someone who gets that not-talking is its own kind of closeness.',
    interests: ['gaming', 'films', 'music', 'coding', 'history', 'cats'],
    comm: 'Co-op mode for life. Sitting together in silence counts as a date.',
    goal: 'friendship', city: 'Denver', tier: 'silent_push',
  },
  {
    name: 'Leena Abadi', tagline: 'Poetry, pottery, and pressed coffee',
    bio: 'I throw clay to slow my brain down and write poems I rarely share. Sensitive to noise and big crowds, generous with attention one-on-one. Looking for gentle and genuine.',
    interests: ['writing', 'crafts', 'art', 'reading', 'tea', 'music'],
    comm: 'I write better than I speak. Let the first dates be by message.',
    goal: 'long-term', city: 'Chicago', tier: 'name_only',
  },
  {
    name: 'Gabriel Stowe', tagline: 'Woodworker who measures twice',
    bio: 'I build furniture slowly and well. Precision calms me. I remember details and keep my promises. I want a calm, honest partnership with room to be ourselves.',
    interests: ['woodworking', 'crafts', 'cooking', 'history', 'nature', 'hiking'],
    comm: 'Honesty over politeness. I would rather know than guess.',
    goal: 'long-term', city: 'Boston', tier: 'in_app',
  },
  {
    name: 'Sora', tagline: 'Aquarium keeper, night owl, gentle nerd',
    bio: 'My tanks are tiny ecosystems and I could watch them for hours. I love structured routines and soft lighting. Seeking patient company and slow-growing trust.',
    interests: ['aquariums', 'science', 'nature', 'gaming', 'reading', 'films'],
    comm: 'Low and slow. Trust builds over time and I am okay waiting for it.',
    goal: 'open', city: 'Seattle', tier: 'in_app',
  },
  {
    name: 'Bex Carlin', tagline: 'Roller-skating archivist',
    bio: 'I file the past for a living and skate to clear my head. I love sorting, labelling, and finding order in chaos. Want a steady person to share small joys with.',
    interests: ['skating', 'history', 'libraries', 'music', 'photography', 'crafts'],
    comm: 'Clear plans make me feel safe. Surprises are not my favourite.',
    goal: 'friendship', city: 'Denver', tier: 'name_only',
  },
  {
    name: 'Omar Haddad', tagline: 'Tea, trains, and topographic maps',
    bio: 'I plan rail journeys for fun and brew tea by the gram. Comfortable in routine, loyal to a fault. Looking for a calm companion who likes the scenic, slower route.',
    interests: ['trains', 'tea', 'maps', 'reading', 'history', 'walking'],
    comm: 'Tell me the plan and the time. Knowing what is next settles me.',
    goal: 'long-term', city: 'Boston', tier: 'silent_push',
  },
  {
    name: 'Talia Friedman', tagline: 'Choir alto and crossword finisher',
    bio: 'I sing in a community choir and finish the cryptic in ink. Words are my playground. Patient and warm once I feel safe. Seeking depth, not speed.',
    interests: ['music', 'puzzles', 'writing', 'reading', 'baking', 'tea'],
    comm: 'I need a little quiet after socialising. It is not you, it is recharge.',
    goal: 'long-term', city: 'Chicago', tier: 'in_app',
  },
  {
    name: 'Kit', tagline: 'Lego architect and list maker',
    bio: 'I build cities out of bricks and keep colour-coded lists for everything. Structure is freedom. I want a kind, steady person who finds my routines endearing, not odd.',
    interests: ['lego', 'crafts', 'gaming', 'coding', 'films', 'science'],
    comm: 'Lists and plans, please. I love a shared spreadsheet of date ideas.',
    goal: 'open', city: 'Austin', tier: 'in_app',
  },
];

function slugEmail(name, i) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
  return `${base}.${i}@sample.spectrum-dating.app`;
}

async function postJSON(path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method: path === '/profile/me' ? 'PUT' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function run() {
  console.log(`Seeding ${USERS.length} users -> ${API}\n`);
  let ok = 0, fail = 0;

  for (let i = 0; i < USERS.length; i++) {
    const u = USERS[i];
    const email = slugEmail(u.name, i);

    // 1. Register
    const reg = await postJSON('/auth/register', { email, password: PASSWORD });
    if (reg.status !== 200 && reg.status !== 201) {
      console.log(`✗ ${u.name.padEnd(22)} register failed (${reg.status}): ${JSON.stringify(reg.data).slice(0, 120)}`);
      fail++; continue;
    }
    const token = reg.data.token;

    // 2. Complete profile (this also satisfies the onboarding gate)
    const prof = await postJSON('/profile/me', {
      displayName: u.name.slice(0, 30),
      tagline: u.tagline.slice(0, 80),
      bio: u.bio.slice(0, 500),
      commNote: u.comm.slice(0, 120),
      relationshipGoal: u.goal,
      distCity: u.city.slice(0, 100),
      notificationTier: u.tier,
      interests: u.interests.slice(0, 50),
    }, token);

    if (prof.status !== 200) {
      console.log(`✗ ${u.name.padEnd(22)} profile failed (${prof.status}): ${JSON.stringify(prof.data).slice(0, 120)}`);
      fail++; continue;
    }

    console.log(`✓ ${u.name.padEnd(22)} ${u.city.padEnd(9)} ${u.goal.padEnd(10)} [${u.interests.length} interests]  ${email}`);
    ok++;
  }

  console.log(`\nDone. ${ok} created, ${fail} failed. Login password for all: ${PASSWORD}`);
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
