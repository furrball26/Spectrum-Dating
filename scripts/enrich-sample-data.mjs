// enrich-sample-data.mjs — give sample users rich profiles (prompts, sensory,
// comms-style, context cards, lifestyle) AND seed real conversations with
// message history, so the app feels populated for demos/testing.
//
// Run: node scripts/enrich-sample-data.mjs
// Rate-limit aware: logs in <= ~16 users per run (auth limiter is 20/15min/IP).
// Idempotent-ish: profile PUTs overwrite; matches/convos are create-or-reuse.

const API = process.argv[2] || 'https://spectrum-dating-server-production.up.railway.app';
const PW = 'SamplePass123!';
const email = (slug, i) => `${slug}.${i}@sample.spectrum-dating.app`;

// index → slug (matches the original seed slug rule)
const SLUG = {
  0:'quiet.cartographer',1:'mira.k',2:'dev',3:'rowan.ashby',4:'priya.s',5:'sam.halloran',
  6:'toby',7:'nadia.okonkwo',8:'eli.brenner',9:'wren',10:'hassan.reyes',11:'june.park',
  12:'marco',13:'ana.beltran',
};

// Rich profile data per user (on-persona, varied).
const RICH = {
  0: { sensoryEnvironment:'quiet', sensoryLighting:'dim', socialDuration:'short', commDirectness:'direct', commLiteral:'literal', commCadence:'whenever', wantsChildren:'open', smoking:'no', drinking:'sometimes',
       contextCard:'I love comfortable silence. If I go quiet on a walk, it means I am happy, not bored.',
       prompts:[{promptKey:'a_perfect_day',answer:'A long quiet walk with a map, a thermos of tea, and no fixed plan.'},{promptKey:'understand_me',answer:'I think before I speak. A pause is me being careful, not distant.'}] },
  1: { sensoryEnvironment:'quiet', sensoryLighting:'dim', socialDuration:'medium', commDirectness:'direct', commLiteral:'literal', commCadence:'daily', wantsChildren:'yes', smoking:'no', drinking:'no',
       contextCard:'Ask me direct questions — hints get lost on me, and I love clarity.',
       prompts:[{promptKey:'talk_for_hours',answer:'Photosynthesis, honestly. And why the night sky changes through the year.'},{promptKey:'green_flag',answer:'Someone who says what they mean and means what they say.'}] },
  2: { sensoryEnvironment:'either', sensoryLighting:'dim', socialDuration:'medium', commDirectness:'direct', commLiteral:'playful', commCadence:'daily', wantsChildren:'open', smoking:'no', drinking:'sometimes',
       contextCard:'I plan dates in a spreadsheet. It is a love language, I promise.',
       prompts:[{promptKey:'good_first_meet',answer:'A quiet cafe with a shared list of things we both want to try.'},{promptKey:'recharge',answer:'Building a tiny tool nobody asked for, with lo-fi on.'}] },
  3: { sensoryEnvironment:'quiet', sensoryLighting:'bright', socialDuration:'long', commDirectness:'softened', commLiteral:'literal', commCadence:'whenever', wantsChildren:'no', smoking:'no', drinking:'no',
       contextCard:'No need to fill every silence. On a dawn walk, the quiet is the point.',
       prompts:[{promptKey:'passionate',answer:'Birds. 312 species so far. I will absolutely show you the warblers.'},{promptKey:'weekend',answer:'Out at first light with binoculars, back for a slow breakfast.'}] },
  4: { sensoryEnvironment:'quiet', sensoryLighting:'dim', socialDuration:'short', commDirectness:'softened', commLiteral:'literal', commCadence:'whenever', wantsChildren:'yes', smoking:'no', drinking:'no',
       contextCard:'I need processing time before big conversations. Texts first is kinder to me.',
       prompts:[{promptKey:'small_joy',answer:'The exact moment sourdough finishes proving. Pure quiet satisfaction.'},{promptKey:'comfortable_when',answer:'Dim lights, a warm kitchen, and no pressure to perform.'}] },
  5: { sensoryEnvironment:'quiet', sensoryLighting:'dim', socialDuration:'medium', commDirectness:'softened', commLiteral:'playful', commCadence:'daily', wantsChildren:'open', smoking:'no', drinking:'sometimes',
       contextCard:'I communicate best in writing. Long messages are welcome and always returned.',
       prompts:[{promptKey:'talk_for_hours',answer:'Why a record sounds warmer than a stream, and twelve other things.'},{promptKey:'good_first_meet',answer:'Sharing headphones, one ear each, no talking required.'}] },
  6: { sensoryEnvironment:'quiet', sensoryLighting:'bright', socialDuration:'medium', commDirectness:'direct', commLiteral:'literal', commCadence:'daily', wantsChildren:'yes', smoking:'no', drinking:'no',
       contextCard:'Predictable plans help me thrive. Tell me what to expect and I am all in.',
       prompts:[{promptKey:'understand_me',answer:'Routine is romance to me. Same cafe, same time, happily, forever.'},{promptKey:'passionate',answer:'Trains. Yes, I know the timetable. Yes, I will tell you about the rolling stock.'}] },
  7: { sensoryEnvironment:'quiet', sensoryLighting:'dim', socialDuration:'short', commDirectness:'direct', commLiteral:'literal', commCadence:'whenever', wantsChildren:'no', smoking:'no', drinking:'sometimes',
       contextCard:'One-on-one over groups, always. Crowds drain me; a quiet corner refills me.',
       prompts:[{promptKey:'recharge',answer:'Watercolour miniatures — noticing the detail everyone else walks past.'},{promptKey:'green_flag',answer:'Happy to skip the small talk and go straight to the real conversation.'}] },
  8: { sensoryEnvironment:'quiet', sensoryLighting:'bright', socialDuration:'medium', commDirectness:'direct', commLiteral:'literal', commCadence:'daily', wantsChildren:'open', smoking:'no', drinking:'sometimes',
       contextCard:'Say what you mean directly — I will never read between the lines well.',
       prompts:[{promptKey:'a_perfect_day',answer:'A hard chess problem, soup on the stove, and a long board-game evening.'},{promptKey:'looking_for',answer:'Something steady and low-drama. I build slowly and stay.'}] },
  9: { sensoryEnvironment:'quiet', sensoryLighting:'dim', socialDuration:'long', commDirectness:'softened', commLiteral:'playful', commCadence:'whenever', wantsChildren:'no', smoking:'no', drinking:'no',
       contextCard:'Parallel play is my love language — we can be alone together, comfortably.',
       prompts:[{promptKey:'small_joy',answer:'Casting on a new sweater I will absolutely not finish before the next one.'},{promptKey:'comfortable_when',answer:'Two cats, a podcast, and yarn. I stim with it and I am unbothered.'}] },
  10:{ sensoryEnvironment:'either', sensoryLighting:'bright', socialDuration:'long', commDirectness:'direct', commLiteral:'literal', commCadence:'daily', wantsChildren:'open', smoking:'no', drinking:'sometimes',
       contextCard:'Give me a heads-up before plans change — spontaneity stresses me more than it should.',
       prompts:[{promptKey:'passionate',answer:'Bouldering. It keeps my body busy so my mind can finally rest.'},{promptKey:'good_first_meet',answer:'A planned walk with a route I have already mapped. Shared itinerary, please.'}] },
  11:{ sensoryEnvironment:'quiet', sensoryLighting:'dim', socialDuration:'medium', commDirectness:'softened', commLiteral:'literal', commCadence:'whenever', wantsChildren:'yes', smoking:'no', drinking:'no',
       contextCard:'Quiet evenings, low lighting, no pressure to perform. That is genuinely me.',
       prompts:[{promptKey:'recharge',answer:'A quiet library corner, loose-leaf tea, and a very long book.'},{promptKey:'understand_me',answer:'I warm up slowly. After a few good chats I am much more myself.'}] },
  12:{ sensoryEnvironment:'quiet', sensoryLighting:'bright', socialDuration:'medium', commDirectness:'direct', commLiteral:'literal', commCadence:'daily', wantsChildren:'yes', smoking:'no', drinking:'no',
       contextCard:'Routines are how I show love. Same coffee shop, same time — happily.',
       prompts:[{promptKey:'weekend',answer:'The same morning bike loop, noticing one new thing every single time.'},{promptKey:'looking_for',answer:'A co-pilot, not a whirlwind. Steady and kind.'}] },
  13:{ sensoryEnvironment:'quiet', sensoryLighting:'dim', socialDuration:'short', commDirectness:'softened', commLiteral:'literal', commCadence:'whenever', wantsChildren:'open', smoking:'no', drinking:'sometimes',
       contextCard:'Give me time to warm up. I send twelve documentaries when I like you — that is the tell.',
       prompts:[{promptKey:'small_joy',answer:'Pressing a flower from somewhere new and labelling it carefully.'},{promptKey:'talk_for_hours',answer:'Niche documentaries. I will send you a list. A long list.'}] },
};

// Conversation threads between pairs (by index). Calm, on-brand, alternating a/b.
const THREADS = [
  { a:0, b:3, msgs:[ // Quiet Cartographer & Rowan
    ['a',"Hi Rowan. I saw we both walk at dawn — quietest, best part of the day."],
    ['b',"It really is. Fewer people, more warblers. Do you map the routes you take?"],
    ['a',"Always. Hand-drawn, fine-liner. I could bring one next time, if you'd like."],
    ['b',"I would love that. No rush though — whenever feels right."],
    ['a',"That suits me well. Maybe a quiet weekday morning?"],
  ]},
  { a:1, b:8, msgs:[ // Mira & Eli
    ['a',"Hi Eli. Botanist meets chess — I suspect we both like systems."],
    ['b',"Guilty. I think in systems and cook in batches. What are you growing right now?"],
    ['a',"Forty houseplants, all named. Direct question for you: tea or coffee person?"],
    ['b',"Tea, strong, no ceremony. I like that you ask things plainly."],
    ['a',"It's the only way I know how. A quiet greenhouse sometime?"],
  ]},
  { a:5, b:7, msgs:[ // Sam & Nadia
    ['a',"Hello Nadia. 'Skip the small talk' — finally, someone who gets it."],
    ['b',"Right? Tell me something real. What record is on while you read?"],
    ['a',"Post-rock for walks, jazz for focus. You'd paint to the jazz, I think."],
    ['b',"I would. Miniatures, slow and small. A quiet afternoon, maybe?"],
  ]},
  { a:11, b:6, msgs:[ // June & Toby
    ['a',"Hi Toby. A library lurker and a trainspotter — we'd be very calm together."],
    ['b',"Predictably calm. I find that comforting, honestly. Same time each week?"],
    ['a',"That sounds lovely. Knowing what's next settles me too."],
  ]},
  { a:2, b:13, msgs:[ // Dev & Ana
    ['a',"Hi Ana. Fair warning: I made a spreadsheet of cafes we could try."],
    ['b',"That's not a red flag, that's a green one. Send it over?"],
    ['a',"Sending now. Quietest one is highlighted. We could start there, no pressure."],
    ['b',"Perfect. I'll bring a pressed flower for the occasion."],
  ]},
];

async function jfetch(method, path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type':'application/json', ...(token?{Authorization:`Bearer ${token}`}:{}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let d; try { d = await res.json(); } catch { d = {}; }
  return { s: res.status, d };
}
const login = async (i) => (await jfetch('POST','/auth/login',{email:email(SLUG[i],i),password:PW})).d;
const sleep = (ms) => new Promise(r=>setTimeout(r,ms));

async function run() {
  const tok = {}, id = {};
  const indices = Object.keys(SLUG).map(Number);

  // 1. Log in + enrich profiles
  let enriched = 0;
  for (const i of indices) {
    const lj = await login(i);
    if (!lj.token) { console.log(`✗ login ${SLUG[i]}.${i} (${lj.error||'blocked'})`); continue; }
    tok[i] = lj.token; id[i] = lj.userId;
    const r = RICH[i];
    if (r) {
      const { prompts, ...fields } = r;
      const p1 = await jfetch('PUT','/profile/me', fields, lj.token);
      const p2 = await jfetch('PUT','/profile/prompts', { prompts }, lj.token);
      if (p1.s===200 && p2.s===200) { enriched++; console.log(`✓ enriched ${SLUG[i]}.${i}`); }
      else console.log(`~ partial ${SLUG[i]}.${i} profile:${p1.s} prompts:${p2.s} ${p1.d.error||p2.d.error||''}`);
    }
  }
  console.log(`\nProfiles enriched: ${enriched}\n`);

  // 2. Seed conversations with messages
  let threads = 0, sent = 0;
  for (const th of THREADS) {
    const { a, b, msgs } = th;
    if (!tok[a] || !tok[b]) { console.log(`~ skip thread ${a}<->${b} (missing token)`); continue; }
    // ensure mutual match
    await jfetch('POST','/matching/swipe',{candidateId:id[b],decision:'like'},tok[a]);
    const sw = await jfetch('POST','/matching/swipe',{candidateId:id[a],decision:'like'},tok[b]);
    let matchId = sw.d.matchId;
    if (!matchId) { // already matched — find it
      const m = await jfetch('GET','/matching/matches',null,tok[a]);
      const found = (m.d.matches||[]).find(x=>x.otherUser.userId===id[b]);
      matchId = found?.matchId;
    }
    if (!matchId) { console.log(`~ no match ${a}<->${b}`); continue; }
    // create conversation (or reuse)
    let conv = await jfetch('POST','/messaging/conversations',{matchId},tok[a]);
    let convId = conv.d.conversation?.id || conv.d.conversationId;
    if (!convId && conv.s===409) convId = conv.d.conversationId;
    if (!convId) { console.log(`~ no convo ${a}<->${b} (${conv.s} ${conv.d.error||''})`); continue; }
    // send messages alternating
    for (const [who, text] of msgs) {
      const t = who==='a'?tok[a]:tok[b];
      const r = await jfetch('POST',`/messaging/conversations/${convId}/messages`,{body:text},t);
      if (r.s===201||r.s===200) sent++;
      await sleep(120);
    }
    threads++;
    console.log(`✓ thread ${SLUG[a]} <-> ${SLUG[b]} (${msgs.length} messages)`);
  }
  console.log(`\nConversations seeded: ${threads}, messages sent: ${sent}`);
}
run().catch(e=>console.error('Fatal:',e.message));
