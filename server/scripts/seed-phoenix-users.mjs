// seed-phoenix-users.mjs — add 20 more sample users, all located in the
// Phoenix, AZ metro with real Phoenix-area postal codes in dist_city.
// Run: node scripts/seed-phoenix-users.mjs [API_BASE]
// Resume (auth limiter is 20/15min/IP): START=10 COUNT=10 node scripts/seed-phoenix-users.mjs

const API = process.argv[2] || 'https://spectrum-dating-server-production.up.railway.app';
const PASSWORD = 'SamplePass123!';
const START = parseInt(process.env.START) || 0;
const COUNT = parseInt(process.env.COUNT) || Infinity;

// city field carries "City, AZ ZIP" — the ZIP is a real Phoenix-metro postal code.
const USERS = [
  { email: 'harper.quinn.phx@sample.spectrum-dating.app', name: 'Harper Quinn', tagline: 'Desert hikes and hand-thrown mugs', bio: 'I hike the same Phoenix trail at sunrise and throw ceramics by night. Calm, observant, happiest with a thermos and good company who likes quiet.', interests: ['hiking','pottery','tea','photography','nature','reading'], comm: 'Async text suits me. I reply when I have something real to say.', goal: 'long-term', city: 'Phoenix, AZ 85004', tier: 'in_app' },
  { email: 'diego.salazar.phx@sample.spectrum-dating.app', name: 'Diego Salazar', tagline: 'Dark-sky chaser and slow cook', bio: 'Tempe by day, the desert sky by night. I drive out past the lights to watch meteor showers and will absolutely info-dump about them.', interests: ['astronomy','science','cooking','walking','music','films'], comm: 'Tell me the plan and the time and I am happy. Surprises rattle me.', goal: 'open', city: 'Tempe, AZ 85281', tier: 'silent_push' },
  { email: 'noor.hassan.phx@sample.spectrum-dating.app', name: 'Noor Hassan', tagline: 'Painter of saguaros and small light', bio: 'I paint the desert in watercolour and notice the detail others walk past. Soft-spoken, deeply loyal, and most myself one-on-one.', interests: ['art','crafts','nature','reading','gardening','films'], comm: 'One-on-one over crowds. A quiet corner refills me.', goal: 'long-term', city: 'Scottsdale, AZ 85251', tier: 'name_only' },
  { email: 'theo.lindqvist.phx@sample.spectrum-dating.app', name: 'Theo Lindqvist', tagline: 'Model railways and exact timetables', bio: 'I build model railways with absurd precision and remember the things you care about. Routine is romance to me. Looking for steady and kind.', interests: ['trains','history','crafts','science','maps','gaming'], comm: 'Predictable plans help me thrive. Tell me what to expect, please.', goal: 'long-term', city: 'Mesa, AZ 85201', tier: 'in_app' },
  { email: 'priscilla.vance.phx@sample.spectrum-dating.app', name: 'Priscilla Vance', tagline: 'Sourdough scientist, dim-light lover', bio: 'Bread is a relationship and I am committed. Sensory-sensitive, so quiet cafes and soft lighting win me every time. I read cookbooks like novels.', interests: ['baking','cooking','reading','crafts','tea','gardening'], comm: 'Texts over calls. I need processing time before big conversations.', goal: 'long-term', city: 'Chandler, AZ 85224', tier: 'name_only' },
  { email: 'ravi.menon.phx@sample.spectrum-dating.app', name: 'Ravi Menon', tagline: 'Chess, tiny tools, and good coffee', bio: 'I think in systems and build little apps nobody asked for. Competitive at chess, gentle about it. Seeking a low-drama companion for small routines.', interests: ['chess','coding','puzzles','cooking','science','board games'], comm: 'Say what you mean directly. I never read between the lines well.', goal: 'long-term', city: 'Gilbert, AZ 85234', tier: 'in_app' },
  { email: 'sage.whitman.phx@sample.spectrum-dating.app', name: 'Sage Whitman', tagline: 'Birdwatcher with a very long list', bio: 'Out at dawn for the desert birds. I find people like I find birds — patiently, with binoculars and a lot of waiting. Want to come along?', interests: ['birdwatching','nature','photography','hiking','walking','science'], comm: 'Low-pressure pacing. No need to fill every silence on a walk.', goal: 'friendship', city: 'Glendale, AZ 85301', tier: 'in_app' },
  { email: 'lucia.moreno.phx@sample.spectrum-dating.app', name: 'Lucia Moreno', tagline: 'Cactus collector, slow Sundays', bio: 'I keep 50 cacti alive and named and could talk about them for hours. Routine-loving and nurturing. I want something steady, kind, and unhurried.', interests: ['gardening','botany','nature','baking','crafts','reading'], comm: 'Plain words, kind tone. I do not do mind games or guessing.', goal: 'long-term', city: 'Phoenix, AZ 85013', tier: 'in_app' },
  { email: 'owen.frost.phx@sample.spectrum-dating.app', name: 'Owen Frost', tagline: 'Woodworker who measures twice', bio: 'I build furniture slowly and well; precision calms me. I keep my promises and remember details. Looking for a calm, honest partnership.', interests: ['woodworking','crafts','cooking','history','hiking','nature'], comm: 'Honesty over politeness. I would rather know than guess.', goal: 'long-term', city: 'Peoria, AZ 85345', tier: 'silent_push' },
  { email: 'amara.okafor.phx@sample.spectrum-dating.app', name: 'Amara Okafor', tagline: 'Poetry, pottery, pressed coffee', bio: 'I throw clay to slow my brain and write poems I rarely share. Sensitive to noise, generous with attention one-on-one. Gentle and genuine, please.', interests: ['writing','pottery','art','reading','tea','music'], comm: 'I write better than I speak. Let the first dates be by message.', goal: 'long-term', city: 'Phoenix, AZ 85016', tier: 'name_only' },
  { email: 'felix.brandt.phx@sample.spectrum-dating.app', name: 'Felix Brandt', tagline: 'Retro carts and quiet co-op', bio: 'I speedrun old platformers and collect cartridges. Happiest gaming side by side with someone who gets that not-talking is its own closeness.', interests: ['gaming','films','music','coding','history','cats'], comm: 'Co-op mode for life. Sitting together in silence counts as a date.', goal: 'friendship', city: 'Tempe, AZ 85283', tier: 'silent_push' },
  { email: 'mei.tanaka.phx@sample.spectrum-dating.app', name: 'Mei Tanaka', tagline: 'Aquariums, night owl, gentle nerd', bio: 'My planted tanks are tiny worlds I could watch for hours. I love structure and soft light. Seeking patient company and slow-growing trust.', interests: ['aquariums','science','nature','gaming','reading','films'], comm: 'Low and slow. Trust builds over time and I am okay waiting.', goal: 'open', city: 'Scottsdale, AZ 85254', tier: 'in_app' },
  { email: 'caleb.ortiz.phx@sample.spectrum-dating.app', name: 'Caleb Ortiz', tagline: 'Same loop, sunrise, every day', bio: 'I ride the same desert loop each morning and notice something new each time. Predictability is comfort, not boredom. I want a co-pilot, not a whirlwind.', interests: ['cycling','maps','photography','cooking','nature','science'], comm: 'Routines are how I show love. Same coffee shop, same time, happily.', goal: 'long-term', city: 'Phoenix, AZ 85020', tier: 'silent_push' },
  { email: 'iris.kovac.phx@sample.spectrum-dating.app', name: 'Iris Kovač', tagline: 'Knitter, podcast hoarder, cat staff', bio: 'I make sweaters faster than I can wear them and two cats run my life. I stim with yarn and I am unbothered. Seeking gentle company and parallel play.', interests: ['knitting','crafts','cats','reading','music','baking'], comm: 'Parallel play is my love language. We can be alone together.', goal: 'friendship', city: 'Mesa, AZ 85205', tier: 'name_only' },
  { email: 'jonah.reed.phx@sample.spectrum-dating.app', name: 'Jonah Reed', tagline: 'Bouldering and shared itineraries', bio: 'Climbing keeps my body busy so my mind can rest. I plan trips in detail and love a shared itinerary. Direct, dependable, quietly affectionate.', interests: ['climbing','hiking','maps','photography','cooking','nature'], comm: 'I like a heads-up before plans change. Spontaneity stresses me.', goal: 'open', city: 'Chandler, AZ 85226', tier: 'in_app' },
  { email: 'talia.bishop.phx@sample.spectrum-dating.app', name: 'Talia Bishop', tagline: 'Choir alto and crossword finisher', bio: 'I sing in a community choir and finish the cryptic in ink. Words are my playground. Patient and warm once I feel safe. Seeking depth, not speed.', interests: ['music','puzzles','writing','reading','baking','tea'], comm: 'I need a little quiet after socialising. It is recharge, not you.', goal: 'long-term', city: 'Phoenix, AZ 85044', tier: 'in_app' },
  { email: 'marcus.lee.phx@sample.spectrum-dating.app', name: 'Marcus Lee', tagline: 'Vinyl records and rainy-day jazz', bio: 'I catalogue my records by mood — jazz for focus, post-rock for walks. Happiest sharing headphones, one ear each, no talking required.', interests: ['music','films','reading','photography','history','walking'], comm: 'I communicate best in writing. Long messages welcome and returned.', goal: 'open', city: 'Surprise, AZ 85374', tier: 'in_app' },
  { email: 'nadia.petrova.phx@sample.spectrum-dating.app', name: 'Nadia Petrova', tagline: 'Documentaries and dried-flower pressing', bio: 'I press flowers from every place I go and label them obsessively. I love niche documentaries and will send you twelve. Shy at first, then all in.', interests: ['films','crafts','gardening','nature','photography','reading'], comm: 'Give me time to warm up. I am most myself after a few good chats.', goal: 'long-term', city: 'Avondale, AZ 85323', tier: 'name_only' },
  { email: 'eli.tanaka.phx@sample.spectrum-dating.app', name: 'Eli Tanaka', tagline: 'Lego cities and colour-coded lists', bio: 'I build cities from bricks and keep colour-coded lists for everything. Structure is freedom. I want someone who finds my routines endearing, not odd.', interests: ['lego','crafts','gaming','coding','films','science'], comm: 'Lists and plans, please. I love a shared spreadsheet of date ideas.', goal: 'open', city: 'Phoenix, AZ 85050', tier: 'in_app' },
  { email: 'rosa.delgado.phx@sample.spectrum-dating.app', name: 'Rosa Delgado', tagline: 'Community gardener with a big heart', bio: 'I grow vegetables for a community plot and feed everyone who visits. Routine-loving and warm. I want something steady, kind, and unhurried.', interests: ['gardening','cooking','volunteering','nature','baking','crafts'], comm: 'Plain words, kind tone. No mind games — just say it.', goal: 'long-term', city: 'Glendale, AZ 85308', tier: 'in_app' },
];

async function postJSON(path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method: path === '/profile/me' ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function run() {
  console.log(`Seeding ${USERS.length} Phoenix users -> ${API}\n`);
  let ok = 0, fail = 0;
  const end = Math.min(USERS.length, START + COUNT);
  for (let i = START; i < end; i++) {
    const u = USERS[i];
    const reg = await postJSON('/auth/register', { email: u.email, password: PASSWORD });
    if (reg.status !== 200 && reg.status !== 201) {
      console.log(`✗ [${i}] ${u.name.padEnd(18)} register ${reg.status}: ${JSON.stringify(reg.data).slice(0,90)}`);
      fail++; continue;
    }
    const prof = await postJSON('/profile/me', {
      displayName: u.name.slice(0,30), tagline: u.tagline.slice(0,80), bio: u.bio.slice(0,500),
      commNote: u.comm.slice(0,120), relationshipGoal: u.goal, distCity: u.city.slice(0,100),
      notificationTier: u.tier, interests: u.interests.slice(0,50),
    }, reg.data.token);
    if (prof.status !== 200) {
      console.log(`✗ [${i}] ${u.name.padEnd(18)} profile ${prof.status}: ${JSON.stringify(prof.data).slice(0,90)}`);
      fail++; continue;
    }
    console.log(`✓ [${i}] ${u.name.padEnd(18)} ${u.city.padEnd(22)} ${u.goal}`);
    ok++;
  }
  console.log(`\nDone. ${ok} created, ${fail} failed.${fail ? ' Re-run with START='+(START+ok)+' after the rate window for the rest.' : ''}`);
}
run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
